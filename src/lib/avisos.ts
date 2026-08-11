import { createClient } from '@/lib/supabase/server';
import { formatarData } from '@/lib/domain/escalas/datas';
import type { Sessao } from './sessao';

/** Quem é avisado, além do gestor — que é sempre avisado. */
export type Alcance = 'afetados' | 'todos';

// Rótulos curtos de propósito: cada linha da tabela do dia tem um seletor
// destes, e um texto longo aparecia cortado no meio — "Avisar: Só quem foi
// alte…" não diz o que a opção faz.
export const ALCANCES: { chave: Alcance; label: string }[] = [
  { chave: 'afetados', label: 'Só quem mudou' },
  { chave: 'todos', label: 'Toda a escala' },
];

/**
 * Avisa quem precisa saber que a escala publicada mudou.
 *
 * Uma alteração manual depois da publicação muda o dia de alguém que já se
 * organizou em cima da escala. Antes o sistema mudava calado: a pessoa
 * descobria ao chegar no lugar errado. Agora:
 *
 * - o gestor da pessoa é avisado SEMPRE, porque a alteração é da equipe dele
 *   e ele responde por ela;
 * - quem sofreu a mudança é avisado sempre;
 * - `todos` estende o aviso a todo mundo escalado no mês, para quando a
 *   mudança de um desloca a rotina dos outros.
 *
 * Nada disso vale para escala em rascunho: ali ninguém viu ainda, e encher o
 * sino de avisos de algo que não existe para a equipe seria ruído.
 */
export async function avisarAlteracaoDaEscala(
  sessao: Sessao,
  {
    geracaoId, competencia, data, colaboradorId, resumo, alcance,
  }: {
    geracaoId: number;
    competencia: string;
    data: string;
    colaboradorId: number;
    resumo: string;
    alcance: Alcance;
  },
): Promise<number> {
  const supabase = await createClient();

  const { data: alvo } = await supabase
    .from('colaboradores')
    .select('nome, perfil_id, gestor_id')
    .eq('id', colaboradorId)
    .maybeSingle();
  if (!alvo) return 0;

  // Set: a mesma pessoa pode ser alvo, gestor e estar na escala do mês.
  const destinos = new Set<string>();
  if (alvo.perfil_id) destinos.add(alvo.perfil_id);
  if (alvo.gestor_id) destinos.add(alvo.gestor_id);

  if (alcance === 'todos') {
    const { data: escalados } = await supabase
      .from('alocacoes')
      .select('colaborador_id')
      .eq('geracao_id', geracaoId);

    const ids = [...new Set((escalados ?? []).map((a: { colaborador_id: number }) => a.colaborador_id))];
    if (ids.length) {
      const { data: pessoas } = await supabase
        .from('colaboradores')
        .select('perfil_id')
        .in('id', ids);
      for (const p of (pessoas ?? []) as { perfil_id: string | null }[]) {
        if (p.perfil_id) destinos.add(p.perfil_id);
      }
    }
  }

  // Quem fez a alteração não precisa ser avisado do que acabou de fazer.
  destinos.delete(sessao.usuario.id);
  if (destinos.size === 0) return 0;

  const linhas = [...destinos].map(perfilId => ({
    conta_id: sessao.conta.id,
    perfil_id: perfilId,
    titulo: `Escala alterada — ${formatarData(data)}`,
    detalhe: `${alvo.nome}: ${resumo}`,
    rota: `/calendario?competencia=${competencia}&dia=${data}`,
    por_id: sessao.usuario.id,
    por_nome: sessao.usuario.nome,
  }));

  await supabase.from('avisos').insert(linhas);
  return linhas.length;
}

/** Avisa um conjunto de perfis sobre um comunicado novo no mural. */
export async function avisarComunicado(
  sessao: Sessao,
  { perfis, titulo }: { perfis: string[]; titulo: string },
): Promise<number> {
  const destinos = new Set(perfis);
  destinos.delete(sessao.usuario.id);
  if (destinos.size === 0) return 0;

  const supabase = await createClient();
  await supabase.from('avisos').insert([...destinos].map(perfilId => ({
    conta_id: sessao.conta.id,
    perfil_id: perfilId,
    titulo: 'Novo comunicado no mural',
    detalhe: titulo,
    rota: '/mural',
    por_id: sessao.usuario.id,
    por_nome: sessao.usuario.nome,
  })));
  return destinos.size;
}
