'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessao, podeCadastrar } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { mensagemErroAuth } from '@/lib/erros-auth';
import { mensagemErroBanco } from '@/lib/erros-banco';
import { senhaTemporaria } from '@/lib/senha';

/**
 * Criação de acessos em lote para quem já está na escala.
 *
 * O buraco que isto fecha: importar a planilha de colaboradores cria a PESSOA
 * na escala, não o LOGIN dela. São dois registros diferentes — `colaboradores`
 * é quem aparece na grade, `perfis` é quem entra no sistema —, e depois de uma
 * importação de oitenta pessoas a única forma de dar acesso era repetir oitenta
 * vezes o convite avulso, cada um devolvendo uma senha que só aparece uma vez
 * na tela e some na navegação seguinte. Na prática ninguém faz isso: ou o
 * acesso não é dado, ou alguém inventa uma senha única para todo mundo.
 *
 * O arranjo é o mesmo da importação por planilha — conferir, olhar, confirmar —
 * e pela mesma razão: aqui se criam credenciais, e a lista do que VAI acontecer
 * precisa ser vista antes de acontecer.
 *
 * Nenhuma das duas funções redireciona: elas devolvem relatório. É o que
 * permite mostrar linha a linha o que houve com cada pessoa, e é obrigatório no
 * segundo passo — as senhas voltam dentro do relatório e não caberiam numa
 * query string, nem deveriam ficar no histórico do navegador.
 */

export interface LinhaConvite {
  colaboradorId: number;
  nome: string;
  matricula: string;
  email: string;
  equipe: string;
  /** `pronto` antes de gravar; `criado` ou `fora` depois. */
  situacao: 'pronto' | 'criado' | 'fora';
  motivo: string;
  /** Só no segundo passo, e só para quem foi criado. Não é gravada em lugar nenhum. */
  senha: string;
}

export interface RelatorioConvite {
  /** Problemas que impedem o lote inteiro. Quando há algum, `linhas` vem vazia. */
  erros: string[];
  linhas: LinhaConvite[];
  prontos: number;
  fora: number;
  /** Preenchido só depois de criar. */
  criados?: number;
}

/**
 * Teto do lote. O Supabase Auth limita chamadas de admin por hora, e um lote
 * grande demais falharia no meio — deixando metade criada e metade não, que é o
 * pior dos dois estados. Quatro centenas cobrem uma operação inteira; acima
 * disso, dois lotes.
 */
const LIMITE = 400;

const PAPEL_LOTE = 'colaborador';
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const vazio = (erro: string): RelatorioConvite => ({ erros: [erro], linhas: [], prontos: 0, fora: 0 });

/**
 * Quem está na escala sem login, e o que impede cada um.
 *
 * Só colaboradores ATIVOS entram na conta: dar acesso a quem foi desligado é
 * justamente o que não se quer fazer em lote e sem olhar.
 */
async function analisar(): Promise<RelatorioConvite> {
  const supabase = await createClient();

  const [{ data: pessoas, error }, { data: equipes }, { data: perfis }] = await Promise.all([
    supabase
      .from('colaboradores')
      .select('id, nome, matricula, email, equipe_id')
      .is('perfil_id', null)
      .eq('status', 'ativo')
      .order('nome'),
    supabase.from('equipes').select('id, nome'),
    supabase.from('perfis').select('email'),
  ]);

  if (error) return vazio(`Não foi possível ler os colaboradores: ${mensagemErroBanco(error)}`);

  const nomeDaEquipe = new Map(((equipes ?? []) as { id: number; nome: string }[]).map(e => [e.id, e.nome]));
  // Os e-mails que já são login NESTA área. Um e-mail de outra organização não
  // aparece aqui — a RLS não o mostra —, e nesse caso quem recusa é o Auth, na
  // hora de criar; a linha volta com a mensagem dele.
  const jaTemLogin = new Set(
    ((perfis ?? []) as { email: string }[]).map(p => (p.email ?? '').trim().toLowerCase()).filter(Boolean),
  );

  const vistos = new Set<string>();
  const linhas: LinhaConvite[] = ((pessoas ?? []) as {
    id: number; nome: string; matricula: string; email: string | null; equipe_id: number;
  }[]).map(c => {
    const email = (c.email ?? '').trim().toLowerCase();
    const base = {
      colaboradorId: c.id,
      nome: c.nome,
      matricula: c.matricula,
      email,
      equipe: nomeDaEquipe.get(c.equipe_id) ?? '—',
      senha: '',
    };

    const fora = (motivo: string) => ({ ...base, situacao: 'fora' as const, motivo });

    if (!email) return fora('Sem e-mail na ficha. Preencha em Colaboradores e volte aqui.');
    if (!EMAIL_VALIDO.test(email)) return fora('E-mail em formato inválido.');
    if (jaTemLogin.has(email)) {
      return fora('Já existe um usuário com este e-mail. Ligue a ficha a ele em Colaboradores → Usuário do sistema.');
    }
    // Dois colaboradores com o mesmo e-mail: o segundo não pode virar login, e
    // recusar os DOIS seria pior — quem digitou o e-mail errado numa linha
    // perderia a certa junto. Passa o primeiro pela ordem de nome, que é
    // estável entre uma conferência e a gravação.
    if (vistos.has(email)) return fora('Este e-mail já aparece em outra linha deste lote.');
    vistos.add(email);

    return { ...base, situacao: 'pronto' as const, motivo: '' };
  });

  return {
    erros: [],
    linhas,
    prontos: linhas.filter(l => l.situacao === 'pronto').length,
    fora: linhas.filter(l => l.situacao === 'fora').length,
  };
}

/** Lê e devolve o que aconteceria. Não cria nada. */
export async function conferirConvites(): Promise<RelatorioConvite> {
  const sessao = await getSessao();
  if (!podeCadastrar(sessao.papel)) return vazio('Só o Planejamento e o Administrador da Área criam acessos.');
  return analisar();
}

/**
 * Cria os logins e devolve a senha de cada um.
 *
 * Uma pessoa de cada vez, e cada uma independente das outras: num lote de
 * oitenta, um e-mail recusado pelo Auth não pode impedir os setenta e nove
 * restantes. O que NÃO é independente é o limite de requisições do Auth — se
 * ele aparecer, o laço para e as pessoas não tentadas voltam dizendo isso, em
 * vez de o sistema insistir e transformar um lote grande em oitenta falhas.
 *
 * O vínculo com a ficha é feito com `perfil_id is null` na condição, e a
 * gravação é conferida pela linha devolvida: sem isso, uma corrida com o
 * convite avulso deixaria dois logins apontando para a mesma pessoa. Quando o
 * vínculo não pega, o login recém-criado é apagado — um acesso sem ficha entra
 * no sistema e não aparece em escala nenhuma.
 */
export async function convidarEmLote(ids: number[]): Promise<RelatorioConvite> {
  const sessao = await getSessao();
  if (!podeCadastrar(sessao.papel)) return vazio('Só o Planejamento e o Administrador da Área criam acessos.');

  const escolhidos = new Set((ids ?? []).map(Number).filter(Number.isFinite));
  if (escolhidos.size === 0) return vazio('Nenhuma pessoa selecionada.');
  if (escolhidos.size > LIMITE) {
    return vazio(`São ${escolhidos.size} pessoas de uma vez — o limite é ${LIMITE}. Faça em lotes menores.`);
  }

  // A conferência da tela é informação para quem olha, não autorização: tudo é
  // relido e revalidado aqui. Entre um passo e outro alguém pode ter criado o
  // login à mão, desligado a pessoa ou corrigido um e-mail.
  const relatorio = await analisar();
  if (relatorio.erros.length) return relatorio;

  const supabase = await createClient();
  const admin = createAdminClient();

  // Quem a tela não marcou sai do relatório: mostrar "fora" para quem ninguém
  // pediu faria o placar final mentir sobre o tamanho do lote.
  const linhas = relatorio.linhas.filter(l => escolhidos.has(l.colaboradorId));
  let criados = 0;
  let travou = '';

  for (const l of linhas) {
    if (l.situacao !== 'pronto') continue;
    if (travou) {
      l.situacao = 'fora';
      l.motivo = travou;
      continue;
    }

    const senha = senhaTemporaria();
    const { data: criado, error } = await admin.auth.admin.createUser({
      email: l.email,
      password: senha,
      email_confirm: true,
      user_metadata: {
        nome: l.nome,
        papel: PAPEL_LOTE,
        conta_id: sessao.conta.id,
        precisa_trocar_senha: true,
      },
    });

    if (error || !criado?.user) {
      l.situacao = 'fora';
      l.motivo = mensagemErroAuth(error);
      // Bater no limite do Auth não é problema desta linha: é do lote. Insistir
      // só queimaria as outras.
      if (error?.code === 'over_request_rate_limit' || /rate limit/i.test(error?.message ?? '')) {
        travou = `${l.motivo} As pessoas abaixo não chegaram a ser tentadas — repita o lote daqui a alguns minutos.`;
      }
      continue;
    }

    const { data: ligado, error: erroVinculo } = await supabase
      .from('colaboradores')
      .update({ perfil_id: criado.user.id })
      .eq('id', l.colaboradorId)
      .is('perfil_id', null)
      .select('id')
      .maybeSingle();

    if (erroVinculo || !ligado) {
      await admin.auth.admin.deleteUser(criado.user.id);
      l.situacao = 'fora';
      l.motivo = erroVinculo
        ? `O acesso foi desfeito porque o vínculo com a ficha falhou: ${mensagemErroBanco(erroVinculo)}`
        : 'O acesso foi desfeito: esta ficha passou a ter um usuário ligado enquanto o lote rodava.';
      continue;
    }

    l.situacao = 'criado';
    l.senha = senha;
    l.motivo = '';
    criados++;
  }

  await registrarLog(
    sessao,
    'Acessos criados em lote',
    `${criados} de ${linhas.length} selecionado(s) · papel ${PAPEL_LOTE}`,
  );

  revalidatePath('/', 'layout');
  return {
    erros: [],
    linhas,
    criados,
    prontos: 0,
    fora: linhas.filter(l => l.situacao === 'fora').length,
  };
}
