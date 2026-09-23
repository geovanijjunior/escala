import type { SessaoAberta } from '../repositories/sessoes.ts';
import * as repositorio from '../repositories/colaboradores.ts';

/**
 * As regras de quem vê quais colaboradores.
 *
 * Esta é a primeira peça da autorização que, no sistema atual, mora nas 75
 * policies de RLS do Postgres. Enquanto a migração corre, as duas existem: o
 * Next.js continua protegido pelo banco, e o que passa por aqui é protegido
 * neste arquivo. A regra fica num SERVIÇO, e não espalhada pelos controladores,
 * porque quando a última tela migrar o que precisa ser auditado contra aquelas
 * policies tem de estar num lugar só.
 *
 * A tradução de papel para recorte é a transcrição de `pode_ver_colaborador`
 * (migration 0026) — a mesma função que as policies usam.
 */

export class SemArea extends Error {
  constructor() {
    super('Seu usuário não está ligado a nenhuma área.');
    this.name = 'SemArea';
  }
}

/**
 * O recorte de quem está perguntando.
 *
 * Um papel desconhecido cai em `colaborador`, o mais restrito — e não em
 * `area`. Se um papel novo for criado e alguém esquecer de tratá-lo aqui, o
 * erro será "esta pessoa vê menos do que devia", que aparece na hora e alguém
 * reclama. O contrário não aparece: ela veria a área inteira e ninguém saberia.
 */
export function recorteDaSessao(sessao: SessaoAberta): repositorio.Recorte {
  if (!sessao.contaId) throw new SemArea();

  switch (sessao.papel) {
    case 'planejamento':
    case 'admin_local':
      return { tipo: 'area', contaId: sessao.contaId };
    case 'gestor':
      return { tipo: 'gestor', contaId: sessao.contaId, perfilId: sessao.perfilId };
    default:
      return { tipo: 'colaborador', contaId: sessao.contaId, perfilId: sessao.perfilId };
  }
}

export async function listarParaSessao(
  sessao: SessaoAberta,
  filtros: { equipeId?: number; somenteAtivos?: boolean } = {},
) {
  return repositorio.listar(recorteDaSessao(sessao), filtros);
}

export async function resumoParaSessao(sessao: SessaoAberta) {
  return repositorio.contar(recorteDaSessao(sessao));
}
