import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';
import type { Conta, PerfilUsuario } from '@/lib/supabase/types';

export interface Sessao {
  usuario: PerfilUsuario;
  conta: Conta;
  papel: PapelEscalas;
  /** Linha em `colaboradores` ligada ao usuário logado, quando existir. */
  colaboradorId: number | null;
}

/**
 * Carrega usuário, conta, papel e a qual colaborador o usuário corresponde.
 *
 * Todo perfil tem papel — quem não tem colaborador vinculado simplesmente não
 * aparece na escala, mas continua operando o sistema conforme o papel.
 *
 * Redireciona para o login se não houver sessão; é defesa em profundidade, já
 * que o proxy.ts barra antes de chegar aqui.
 *
 * Envolvido em `cache()`: o layout e a página chamam esta função na mesma
 * requisição, e sem isso a segunda chamada repetia tudo. O cache do React vale
 * só enquanto a requisição existe — não é cache entre usuários nem entre
 * navegações, então não há risco de vazar sessão de um para outro.
 *
 * As três consultas seguintes são disparadas juntas. `contas` não precisa do
 * conta_id do perfil para ser encontrada: a policy `contas_select` já é
 * `id = conta_id()`, então a tabela inteira, sob RLS, é exatamente a conta do
 * usuário. Isso quebra a dependência que obrigava a esperar `perfis` terminar.
 */
export const getSessao = cache(async function getSessao(): Promise<Sessao> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [perfilRes, contaRes, colabRes] = await Promise.all([
    supabase.from('perfis').select('*').eq('id', user.id).single(),
    supabase.from('contas').select('*').single(),
    supabase.from('colaboradores').select('id').eq('perfil_id', user.id).maybeSingle(),
  ]);

  const perfil = perfilRes.data as PerfilUsuario | null;
  if (!perfil || !contaRes.data) redirect('/login');

  return {
    usuario: perfil,
    conta: contaRes.data as Conta,
    papel: perfil.papel,
    colaboradorId: colabRes.data?.id ?? null,
  };
});

export function ehPlanejamento(papel: PapelEscalas): boolean {
  return papel === 'planejamento';
}

export function podeAprovar(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}

export function podeVerEquipe(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}

/** Barra a ação e volta pra tela de origem com o motivo explícito na query. */
export function exigirPlanejamento(papel: PapelEscalas, voltarPara: string): void {
  if (papel !== 'planejamento') {
    redirect(`${voltarPara}?erro=${encodeURIComponent('Só o Planejamento pode fazer essa alteração.')}`);
  }
}

export function exigirAprovador(papel: PapelEscalas, voltarPara: string): void {
  if (papel !== 'planejamento' && papel !== 'gestor') {
    redirect(`${voltarPara}?erro=${encodeURIComponent('Você não tem permissão para essa ação.')}`);
  }
}

/**
 * Quem pode mexer na escala à mão.
 *
 * O Planejamento monta o mês e ajusta antes e depois de publicar. O gestor
 * ajusta a equipe dele DEPOIS da publicação: antes disso a escala ainda está
 * sendo montada, e mexer num rascunho que vai ser regerado só cria a impressão
 * de que a mudança foi feita. Mês encerrado não aceita ninguém.
 */
export function podeEditarEscala(papel: PapelEscalas, status: string): boolean {
  if (status === 'encerrada') return false;
  if (papel === 'planejamento') return true;
  return papel === 'gestor' && status === 'publicada';
}

export function exigirEditorDeEscala(papel: PapelEscalas, status: string, voltarPara: string): void {
  if (podeEditarEscala(papel, status)) return;
  const motivo = status === 'encerrada'
    ? 'O mês está encerrado e não aceita mais alterações.'
    : papel === 'gestor'
      ? 'O gestor só ajusta a escala depois de publicada.'
      : 'Você não tem permissão para alterar a escala.';
  redirect(`${voltarPara}?erro=${encodeURIComponent(motivo)}`);
}
