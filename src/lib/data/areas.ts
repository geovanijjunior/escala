import { createClient } from '@/lib/supabase/server';

/**
 * O que o Administrador Geral sabe sobre uma área.
 *
 * Repare no que NÃO está aqui: nome de colaborador, escala, solicitação,
 * comunicado. O console de áreas administra instâncias, não pessoas — quem
 * responde pelas pessoas de uma área é o administrador dela. Os números vêm de
 * `resumo_areas()`, uma função `security definer` que devolve só contagens; a
 * alternativa seria abrir exceção na RLS de `colaboradores` e de `geracoes`, e
 * uma exceção aberta para contar é uma exceção aberta para ler.
 */
export interface AdminLocal {
  id: string;
  nome: string;
  email: string;
  bloqueado: boolean;
}

export interface Area {
  id: string;
  nome: string;
  ativa: boolean;
  criadoEm: string;
  colaboradores: number;
  usuarios: number;
  competenciaPublicada: string | null;
  /** Os administradores locais são a única exceção: o Geral os nomeia. */
  admins: AdminLocal[];
}

interface LinhaResumo {
  conta_id: string;
  nome: string;
  ativa: boolean;
  criado_em: string;
  colaboradores: number;
  usuarios: number;
  admins_locais: number;
  competencia_publicada: string | null;
}

export async function listarAreas(): Promise<Area[]> {
  const supabase = await createClient();

  const [resumoRes, adminsRes] = await Promise.all([
    supabase.rpc('resumo_areas'),
    supabase
      .from('perfis')
      .select('id, nome, email, conta_id, bloqueado')
      .eq('papel', 'admin_local')
      .order('nome'),
  ]);

  const resumo = (resumoRes.data ?? []) as LinhaResumo[];
  const admins = (adminsRes.data ?? []) as (AdminLocal & { conta_id: string })[];

  const porArea = new Map<string, AdminLocal[]>();
  for (const a of admins) {
    const lista = porArea.get(a.conta_id) ?? [];
    lista.push({ id: a.id, nome: a.nome, email: a.email, bloqueado: a.bloqueado });
    porArea.set(a.conta_id, lista);
  }

  return resumo.map(r => ({
    id: r.conta_id,
    nome: r.nome,
    ativa: r.ativa,
    criadoEm: r.criado_em,
    colaboradores: Number(r.colaboradores),
    usuarios: Number(r.usuarios),
    competenciaPublicada: r.competencia_publicada,
    admins: porArea.get(r.conta_id) ?? [],
  }));
}
