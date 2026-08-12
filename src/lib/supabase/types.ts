import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

/** Uma área. `contas` é o nome antigo da mesma coisa: a instância isolada. */
export interface Conta {
  id: string;
  nome: string;
  ativa: boolean;
  criado_em: string;
}

export interface PerfilUsuario {
  id: string;
  /**
   * Nulo só para o Administrador Geral, que não pertence a área nenhuma — e é
   * justamente isso que o mantém fora dos dados, já que toda policy do domínio
   * compara `conta_id = conta_id()` e nulo em RLS nega.
   */
  conta_id: string | null;
  nome: string;
  email: string;
  /** Única dimensão de permissão do sistema. */
  papel: PapelEscalas;
  precisa_trocar_senha: boolean;
  bloqueado: boolean;
  /** Instante da última vez que a pessoa abriu o sino de notificações. */
  notificacoes_vistas_em: string;
  /** Última vez que a pessoa abriu o mural, para o menu contar o que chegou depois. */
  mural_visto_em: string;
  criado_em: string;
}

export const ROTULO_PAPEL: Record<PapelEscalas, string> = {
  admin_geral: 'Administrador Geral',
  admin_local: 'Administrador da Área',
  planejamento: 'Planejamento',
  gestor: 'Gestor',
  colaborador: 'Colaborador',
};

export function ehPlanejamento(papel: PapelEscalas): boolean {
  return papel === 'planejamento';
}

export function podeAprovar(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}

export function podeVerEquipe(papel: PapelEscalas): boolean {
  return papel === 'planejamento' || papel === 'gestor';
}
