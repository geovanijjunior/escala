import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

export interface Conta {
  id: string;
  nome: string;
  criado_em: string;
}

export interface PerfilUsuario {
  id: string;
  conta_id: string;
  nome: string;
  email: string;
  /** Única dimensão de permissão do sistema. */
  papel: PapelEscalas;
  precisa_trocar_senha: boolean;
  bloqueado: boolean;
  /** Instante da última vez que a pessoa abriu o sino de notificações. */
  notificacoes_vistas_em: string;
  criado_em: string;
}

export const ROTULO_PAPEL: Record<PapelEscalas, string> = {
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
