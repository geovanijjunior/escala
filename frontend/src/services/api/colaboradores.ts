import { api } from './cliente';

/**
 * As chamadas de colaboradores.
 *
 * Um módulo por recurso, e não `fetch` espalhado pelas telas: o caminho da rota
 * e o formato da resposta ficam num lugar só, e a tela passa a falar de
 * colaboradores em vez de falar de HTTP.
 */

export interface Colaborador {
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

export interface ResumoDeColaboradores {
  total: number;
  ativos: number;
  comAcesso: number;
}

export const colaboradores = {
  listar: (filtros: { equipeId?: number; somenteAtivos?: boolean } = {}) => {
    const busca = new URLSearchParams();
    if (filtros.equipeId) busca.set('equipeId', String(filtros.equipeId));
    if (filtros.somenteAtivos) busca.set('somenteAtivos', 'true');
    const query = busca.toString();
    return api.buscar<Colaborador[]>(`/colaboradores${query ? `?${query}` : ''}`);
  },
  resumo: () => api.buscar<ResumoDeColaboradores>('/colaboradores/resumo'),
};
