import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

/**
 * Os colaboradores — as pessoas que entram na escala.
 *
 * Toda leitura recebe o RECORTE de quem está perguntando, e o recorte entra na
 * consulta, não num `filter` depois. A diferença não é desempenho: filtrar em
 * memória significa que o banco já devolveu a área inteira, e qualquer caminho
 * que devolva a lista antes do filtro — um `catch` mal posto, uma rota nova
 * escrita às pressas — vaza tudo sem dar erro.
 *
 * Até a 0032 quem garantia esse recorte era a RLS do Postgres, que barrava a
 * linha no banco mesmo quando o código esquecia. Com o Prisma conectando como
 * um usuário só, essa rede some. Por isso `Recorte` é parâmetro obrigatório:
 * uma consulta sem ele não compila.
 */

export type Recorte =
  /** Planejamento e Administrador da Área: a área inteira. */
  | { tipo: 'area'; contaId: string }
  /** Gestor: as equipes que gerencia, mais quem o tem como gestor direto. */
  | { tipo: 'gestor'; contaId: string; perfilId: string }
  /** Colaborador: ele mesmo, e os colegas ATIVOS da equipe dele. */
  | { tipo: 'colaborador'; contaId: string; perfilId: string };

export interface ColaboradorDaLista {
  id: number;
  nome: string;
  matricula: string;
  email: string;
  cargo: string;
  regime: string;
  turno: string;
  entrada: string;
  saida: string;
  status: string;
  equipe: string;
  unidadeBase: string;
  temAcesso: boolean;
}

/**
 * Traduz o recorte para a condição da consulta.
 *
 * É a transcrição de `pode_ver_colaborador`, a função que as policies de RLS
 * usam hoje (migration 0026). Qualquer divergência aqui é uma diferença entre o
 * que o sistema atual mostra e o que o novo mostra — por isso a regra está num
 * lugar só, e não repetida em cada consulta.
 */
async function condicaoDoRecorte(recorte: Recorte): Promise<Prisma.colaboradoresWhereInput> {
  const daConta = { conta_id: recorte.contaId };

  if (recorte.tipo === 'area') return daConta;

  if (recorte.tipo === 'gestor') {
    // Duas portas, como na policy: gerenciar a EQUIPE, ou ser o gestor direto
    // da pessoa. A segunda existe para quem responde por alguém fora da própria
    // equipe, e esquecê-la esconderia essas pessoas do gestor delas.
    return {
      ...daConta,
      OR: [
        { equipes: { gestor_id: recorte.perfilId } },
        { gestor_id: recorte.perfilId },
      ],
    };
  }

  // Colaborador: preciso saber de qual equipe ele é, e isso exige olhar a ficha
  // dele antes. Duas consultas, explícitas — melhor do que um `join` que
  // esconde a dependência.
  const eu = await prisma.colaboradores.findFirst({
    where: { conta_id: recorte.contaId, perfil_id: recorte.perfilId },
    select: { id: true, equipe_id: true },
  });

  // Sem ficha na escala, não há equipe e não há colegas. Não é erro: é o caso
  // do login criado antes de a pessoa ser cadastrada.
  if (!eu) return { id: BigInt(-1) };

  return {
    ...daConta,
    OR: [
      // Eu mesmo, em qualquer situação — inclusive afastado ou desligado.
      { id: eu.id },
      // Os colegas, só ATIVOS. A restrição é deliberada e vem da policy: a
      // linha traz o motivo da inativação, que não é assunto da equipe.
      { equipe_id: eu.equipe_id, status: 'ativo' },
    ],
  };
}

export async function listar(
  recorte: Recorte,
  filtros: { equipeId?: number; somenteAtivos?: boolean } = {},
): Promise<ColaboradorDaLista[]> {
  const linhas = await prisma.colaboradores.findMany({
    where: {
      AND: [
        await condicaoDoRecorte(recorte),
        ...(filtros.equipeId ? [{ equipe_id: filtros.equipeId }] : []),
        ...(filtros.somenteAtivos ? [{ status: 'ativo' }] : []),
      ],
    },
    include: {
      equipes: { select: { nome: true } },
      unidades: { select: { nome: true } },
    },
    orderBy: { nome: 'asc' },
  });

  return linhas.map(c => ({
    // A coluna é `bigint` no Postgres, e o Prisma a entrega como `BigInt` do
    // JavaScript — que `JSON.stringify` não sabe serializar: a resposta cairia
    // com "Do not know how to serialize a BigInt", em tempo de execução e só na
    // rota que devolvesse a lista. A conversão fica aqui, na saída do
    // repositório, e não em cada controlador. É segura: `MAX_SAFE_INTEGER` são
    // nove quatrilhões, e esta tabela conta pessoas.
    id: Number(c.id),
    nome: c.nome,
    matricula: c.matricula,
    email: c.email,
    cargo: c.cargo,
    regime: c.regime,
    turno: c.turno,
    entrada: c.entrada,
    saida: c.saida,
    status: c.status,
    equipe: c.equipes?.nome ?? '—',
    unidadeBase: c.unidades?.nome ?? '—',
    // Só o fato, nunca o `perfil_id`: a tela precisa saber se a pessoa já tem
    // login, e não de um identificador que ela não usa para nada.
    temAcesso: c.perfil_id !== null,
  }));
}

export async function contar(recorte: Recorte): Promise<{ total: number; ativos: number; comAcesso: number }> {
  const condicao = await condicaoDoRecorte(recorte);
  const [total, ativos, comAcesso] = await Promise.all([
    prisma.colaboradores.count({ where: condicao }),
    prisma.colaboradores.count({ where: { AND: [condicao, { status: 'ativo' }] } }),
    prisma.colaboradores.count({ where: { AND: [condicao, { NOT: { perfil_id: null } }] } }),
  ]);
  return { total, ativos, comAcesso };
}
