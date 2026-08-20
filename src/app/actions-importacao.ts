'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirCadastrador } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { listarEquipes, listarUnidades } from '@/lib/data/escalas';
import { lerPlanilha, type LinhaImportada } from '@/lib/domain/escalas/importacao';
import { mensagemErroBanco } from '@/lib/erros-banco';

/**
 * Importação de colaboradores por planilha.
 *
 * Dois passos, e é de propósito: `conferirPlanilha` só lê e devolve o que
 * aconteceria; `importarPlanilha` grava. É o mesmo arranjo da geração da escala
 * — simular, olhar, confirmar — e existe pela mesma razão. Uma planilha de
 * duzentas linhas com a coluna de equipe deslocada importa sem reclamar e
 * coloca a operação inteira na unidade errada; o erro só aparece na primeira
 * geração, quando já não se sabe quais linhas vieram do arquivo.
 *
 * A conferência NÃO é a autorização. `importarPlanilha` relê e revalida o
 * arquivo do zero: entre um passo e outro alguém pode ter desativado uma
 * unidade, e o cliente pode mandar qualquer coisa no segundo passo.
 */

export interface Relatorio {
  /** Problemas do arquivo inteiro. Quando há algum, nada é lido. */
  erros: string[];
  ignoradas: string[];
  linhas: (LinhaImportada & { acao: 'criar' | 'atualizar' | 'recusada' })[];
  criar: number;
  atualizar: number;
  recusadas: number;
  /** Preenchido só depois de gravar. */
  gravadas?: number;
}

/** Teto do arquivo. 2000 linhas de CSV não passam de ~300 KB. */
const LIMITE_BYTES = 1024 * 1024;

async function analisar(conteudo: string): Promise<Relatorio> {
  const [equipes, unidades] = await Promise.all([listarEquipes(), listarUnidades()]);
  const leitura = lerPlanilha(conteudo, { equipes, unidades });

  if (leitura.erros.length) {
    return { erros: leitura.erros, ignoradas: leitura.ignoradas, linhas: [], criar: 0, atualizar: 0, recusadas: 0 };
  }

  // Quem já existe é atualizado, não duplicado: a matrícula é a identidade da
  // pessoa. Importar a mesma planilha duas vezes precisa dar o mesmo resultado
  // da primeira — senão ninguém se atreve a corrigir uma linha e reimportar.
  const supabase = await createClient();
  const matriculas = leitura.linhas.map(l => l.matricula).filter(Boolean);
  const { data: existentes } = matriculas.length
    ? await supabase.from('colaboradores').select('id, matricula').in('matricula', matriculas)
    : { data: [] };
  const idPorMatricula = new Map(
    ((existentes ?? []) as { id: number; matricula: string }[]).map(c => [c.matricula, c.id]),
  );

  const linhas = leitura.linhas.map(l => ({
    ...l,
    acao: (l.erros.length ? 'recusada' : idPorMatricula.has(l.matricula) ? 'atualizar' : 'criar') as
      'criar' | 'atualizar' | 'recusada',
  }));

  return {
    erros: [],
    ignoradas: leitura.ignoradas,
    linhas,
    criar: linhas.filter(l => l.acao === 'criar').length,
    atualizar: linhas.filter(l => l.acao === 'atualizar').length,
    recusadas: linhas.filter(l => l.acao === 'recusada').length,
  };
}

/** Lê o arquivo e devolve o que aconteceria. Não grava nada. */
export async function conferirPlanilha(conteudo: string): Promise<Relatorio> {
  const sessao = await getSessao();
  if (sessao.papel !== 'planejamento') {
    return { erros: ['Só o Planejamento importa colaboradores.'], ignoradas: [], linhas: [], criar: 0, atualizar: 0, recusadas: 0 };
  }
  if (conteudo.length > LIMITE_BYTES) {
    return { erros: [`O arquivo tem ${(conteudo.length / 1024).toFixed(0)} KB — o limite é 1 MB.`], ignoradas: [], linhas: [], criar: 0, atualizar: 0, recusadas: 0 };
  }
  return analisar(conteudo);
}

/**
 * Grava. As linhas com erro ficam de fora; as boas entram.
 *
 * Poderia ser tudo-ou-nada, e não é: numa planilha de duzentas pessoas, uma
 * data digitada errado impediria as outras cento e noventa e nove de entrar, e
 * o caminho de volta seria reimportar tudo depois de corrigir. Importar o que
 * está bom e devolver a lista do que ficou de fora deixa o trabalho avançar —
 * e reimportar o arquivo corrigido é seguro, porque a matrícula manda.
 */
export async function importarPlanilha(conteudo: string): Promise<Relatorio> {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, '/colaboradores');

  const relatorio = await analisar(conteudo);
  if (relatorio.erros.length) return relatorio;

  const supabase = await createClient();
  const equipes = await listarEquipes();
  const equipePorId = new Map(equipes.map(e => [e.id, e]));

  const boas = relatorio.linhas.filter(l => l.acao !== 'recusada');
  let gravadas = 0;

  for (const l of boas) {
    const equipe = equipePorId.get(l.equipeId!);
    const registro = {
      conta_id: sessao.conta.id,
      nome: l.nome,
      matricula: l.matricula,
      email: l.email,
      cargo: l.cargo,
      equipe_id: l.equipeId,
      // O regime é da equipe, nunca do arquivo: deixar a planilha declarar
      // regime abriria a porta para uma pessoa 5x2 dentro de uma equipe 12x36,
      // que é um estado que o motor não sabe resolver.
      regime: equipe?.regime ?? '5x2',
      gestor_id: equipe?.gestorId ?? null,
      turno: l.turno,
      ciclo: l.ciclo,
      entrada: l.entrada,
      saida: l.saida,
      unidade_base_id: l.unidadeBaseId,
      eleg_home: l.elegHome,
      eleg_externo: l.elegExterno,
      sexta_reduzida: l.sextaReduzida,
      admissao: l.admissao,
      // `status` fica FORA do payload de propósito. A coluna já nasce 'ativo',
      // então quem é criado entra ativo; e quem já existe mantém o status que
      // tem. Mandar 'ativo' aqui faria uma reimportação de rotina ressuscitar
      // silenciosamente quem foi desligado — a planilha não tem coluna de
      // status, então ela não tem o que dizer sobre isso.
      // Pelo mesmo motivo `perfil_id` não vem: o vínculo com o usuário do
      // sistema é feito na tela e não pode ser desfeito por um arquivo.
    };

    const { error } = await supabase
      .from('colaboradores')
      .upsert(registro, { onConflict: 'conta_id,matricula' });

    if (error) {
      l.acao = 'recusada';
      l.erros.push(`Não foi possível gravar: ${mensagemErroBanco(error)}`);
    } else {
      gravadas++;
    }
  }

  await registrarLog(
    sessao,
    'Colaboradores importados',
    `${gravadas} gravado(s) de ${relatorio.linhas.length} linha(s) · `
      + `${relatorio.criar} novo(s), ${relatorio.atualizar} atualizado(s), `
      + `${relatorio.linhas.length - gravadas} fora`,
  );

  revalidatePath('/', 'layout');
  return {
    ...relatorio,
    recusadas: relatorio.linhas.filter(l => l.acao === 'recusada').length,
    gravadas,
  };
}
