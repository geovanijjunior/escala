import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma.ts';

/**
 * As sessões da aplicação.
 *
 * O padrão de infraestrutura pede sessões geridas pela própria aplicação, e
 * isso é mais do que uma formalidade. A alternativa comum — guardar o token do
 * provedor num cookie e chamar aquilo de sessão — tem dois defeitos que só
 * aparecem tarde: não há como encerrar a sessão do lado de cá (o token vale
 * até vencer, mesmo depois de "sair"), e o token de identidade fica no
 * navegador, onde qualquer extensão o alcança.
 *
 * Aqui o cookie leva um valor opaco e sem significado. O que ele encontra é
 * uma linha desta tabela, que a aplicação cria, renova e apaga quando quer.
 */

/** Quanto tempo uma sessão vale sem uso antes de ser considerada abandonada. */
const OCIOSIDADE_HORAS = 2;

export interface SessaoAberta {
  perfilId: string;
  nome: string;
  email: string;
  papel: string;
  contaId: string | null;
  bloqueado: boolean;
}

/**
 * O que é guardado é o HASH do valor do cookie, nunca o valor.
 *
 * Um dump do banco, ou o olhar de quem tem leitura nele, não entrega a sessão
 * de ninguém — é a mesma razão de não guardar senha em claro. O custo é que a
 * busca tem de ser pelo hash, o que é exatamente o que `id` é aqui.
 */
const impressao = (valor: string) => createHash('sha256').update(valor).digest('hex');

export async function abrirSessao(dados: {
  perfilId: string;
  horas: number;
  ssoSid: string;
  ssoRefresh: string | null;
  ip: string;
  agente: string;
}): Promise<string> {
  // 32 bytes de aleatoriedade criptográfica. É a credencial que substitui a
  // senha pelo resto da sessão; `Math.random` aqui seria adivinhável.
  const valor = randomBytes(32).toString('base64url');

  await prisma.sessoes.create({
    data: {
      id: impressao(valor),
      perfil_id: dados.perfilId,
      expira_em: new Date(Date.now() + dados.horas * 3600_000),
      sso_sid: dados.ssoSid,
      sso_refresh: dados.ssoRefresh,
      ip: dados.ip,
      agente: dados.agente.slice(0, 300),
    },
  });

  return valor;
}

/**
 * A sessão por trás do cookie, se ela ainda vale.
 *
 * Devolve o perfil junto porque toda requisição autenticada precisa dos dois,
 * e duas consultas por requisição — uma para a sessão, outra para o perfil —
 * dobrariam o piso de ida e volta ao banco de cada página.
 */
export async function sessaoValida(valorDoCookie: string): Promise<SessaoAberta | null> {
  if (!valorDoCookie) return null;

  const linha = await prisma.sessoes.findUnique({
    where: { id: impressao(valorDoCookie) },
    include: { perfis: true },
  });

  if (!linha || linha.encerrada_em) return null;

  const agora = new Date();
  if (linha.expira_em <= agora) return null;

  // Ociosidade é diferente de validade: a sessão dura oito horas, mas duas
  // horas sem nenhum acesso indicam um navegador esquecido aberto, que é o
  // caso que a expiração longa não cobre.
  if (agora.getTime() - linha.ultimo_uso.getTime() > OCIOSIDADE_HORAS * 3600_000) {
    await encerrarSessao(valorDoCookie);
    return null;
  }

  // Gravado sem esperar: a requisição não depende disto, e um `await` aqui põe
  // uma escrita no caminho crítico de toda página. Um erro aqui não pode
  // derrubar a requisição — no pior caso a sessão parece mais ociosa do que é.
  void prisma.sessoes.update({
    where: { id: linha.id },
    data: { ultimo_uso: agora },
  }).catch(() => {});

  const p = linha.perfis;
  return {
    perfilId: p.id,
    nome: p.nome,
    email: p.email,
    papel: p.papel,
    contaId: p.conta_id,
    bloqueado: p.bloqueado,
  };
}

export async function encerrarSessao(valorDoCookie: string): Promise<void> {
  await prisma.sessoes.updateMany({
    where: { id: impressao(valorDoCookie), encerrada_em: null },
    data: { encerrada_em: new Date() },
  });
}

/** Todas as sessões de uma pessoa — usado ao bloquear o acesso dela. */
export async function encerrarSessoesDoPerfil(perfilId: string): Promise<number> {
  const r = await prisma.sessoes.updateMany({
    where: { perfil_id: perfilId, encerrada_em: null },
    data: { encerrada_em: new Date() },
  });
  return r.count;
}

/**
 * Limpeza do que já venceu.
 *
 * Sessões encerradas e vencidas não servem a nada e a tabela só cresce. Ficam
 * sete dias antes de sumir: é o que permite responder "de onde esta pessoa
 * entrou na terça?" quando alguém pergunta.
 */
export async function limparSessoesVencidas(): Promise<number> {
  const corte = new Date(Date.now() - 7 * 24 * 3600_000);
  const r = await prisma.sessoes.deleteMany({
    where: { expira_em: { lt: corte } },
  });
  return r.count;
}
