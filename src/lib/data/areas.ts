import { createClient } from '@/lib/supabase/server';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

/**
 * O que o Administrador Geral sabe sobre uma área.
 *
 * Repare no que continua NÃO estando aqui: nome de colaborador, escala,
 * solicitação, comunicado. O console de áreas administra instâncias e acessos —
 * quem responde pela operação de uma área é o administrador dela.
 *
 * O que entrou foi a lista de usuários: quem tem login, com que papel, e se
 * está bloqueado. Quem responde pelo sistema precisa saber quem entra nele.
 * Isso é diferente de `colaboradores`, que carrega matrícula, cargo, jornada e
 * admissão — dado de pessoa, que segue fechado na área.
 *
 * Os números de colaboradores e da competência publicada continuam vindo de
 * `resumo_areas()`, uma função `security definer` que devolve só contagens: a
 * alternativa seria abrir a RLS dessas tabelas, e uma exceção aberta para contar
 * é uma exceção aberta para ler.
 */
export interface UsuarioArea {
  id: string;
  nome: string;
  email: string;
  papel: PapelEscalas;
  bloqueado: boolean;
}

export interface Area {
  id: string;
  nome: string;
  ativa: boolean;
  criadoEm: string;
  colaboradores: number;
  competenciaPublicada: string | null;
  /** Todos os logins da área, do administrador ao colaborador. */
  usuarios: UsuarioArea[];
  /** Os administradores locais — os únicos que o Geral nomeia e bloqueia. */
  admins: UsuarioArea[];
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

/** Administrador primeiro, depois Planejamento, gestor e colaborador. */
const ORDEM_PAPEL: Record<string, number> = {
  admin_local: 0,
  planejamento: 1,
  gestor: 2,
  colaborador: 3,
};

export function rotuloPapel(papel: PapelEscalas): string {
  switch (papel) {
    case 'admin_geral': return 'Administrador Geral';
    case 'admin_local': return 'Administrador da Área';
    case 'planejamento': return 'Planejamento';
    case 'gestor': return 'Gestor';
    default: return 'Colaborador';
  }
}

export async function listarAreas(): Promise<Area[]> {
  const supabase = await createClient();

  // Uma consulta só para os perfis de todas as áreas, agrupada em memória: com
  // a policy `perfis_select` da 0016 o Geral lê todos, e uma chamada por área
  // faria N requisições para montar a mesma lista.
  const [resumoRes, perfisRes] = await Promise.all([
    supabase.rpc('resumo_areas'),
    supabase
      .from('perfis')
      .select('id, nome, email, papel, conta_id, bloqueado')
      .not('conta_id', 'is', null)
      .order('nome'),
  ]);

  const resumo = (resumoRes.data ?? []) as LinhaResumo[];
  const perfis = (perfisRes.data ?? []) as (UsuarioArea & { conta_id: string })[];

  const porArea = new Map<string, UsuarioArea[]>();
  for (const p of perfis) {
    const lista = porArea.get(p.conta_id) ?? [];
    lista.push({ id: p.id, nome: p.nome, email: p.email, papel: p.papel, bloqueado: p.bloqueado });
    porArea.set(p.conta_id, lista);
  }

  for (const lista of porArea.values()) {
    lista.sort((a, b) => (ORDEM_PAPEL[a.papel] ?? 9) - (ORDEM_PAPEL[b.papel] ?? 9)
      || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  return resumo.map(r => {
    const usuarios = porArea.get(r.conta_id) ?? [];
    return {
      id: r.conta_id,
      nome: r.nome,
      ativa: r.ativa,
      criadoEm: r.criado_em,
      colaboradores: Number(r.colaboradores),
      competenciaPublicada: r.competencia_publicada,
      usuarios,
      admins: usuarios.filter(u => u.papel === 'admin_local'),
    };
  });
}
