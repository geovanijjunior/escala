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
 */
export async function getSessao(): Promise<Sessao> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: perfil } = await supabase.from('perfis').select('*').eq('id', user.id).single();
  if (!perfil) redirect('/login');

  const { data: conta } = await supabase.from('contas').select('*').eq('id', perfil.conta_id).single();
  if (!conta) redirect('/login');

  const { data: colab } = await supabase
    .from('colaboradores')
    .select('id')
    .eq('perfil_id', user.id)
    .maybeSingle();

  return {
    usuario: perfil as PerfilUsuario,
    conta: conta as Conta,
    papel: (perfil as PerfilUsuario).papel,
    colaboradorId: colab?.id ?? null,
  };
}

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
