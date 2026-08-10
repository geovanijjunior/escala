import { iso } from '@/lib/domain/escalas/datas';

export type Busca = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

/** Competência pedida na URL, ou o mês corrente quando ausente/ inválida. */
export function competenciaDaBusca(busca: Busca): string {
  const bruta = um(busca.competencia);
  if (/^\d{4}-\d{2}-01$/.test(bruta)) return bruta;
  const hoje = new Date();
  return iso(hoje.getFullYear(), hoje.getMonth(), 1);
}

export function texto(busca: Busca, campo: string): string {
  return um(busca[campo]);
}

export function numero(busca: Busca, campo: string): number | null {
  const v = Number(um(busca[campo]));
  return Number.isFinite(v) && v !== 0 ? v : null;
}

/** Reconstrói a query string mudando só os campos informados. */
export function comFiltros(busca: Busca, mudancas: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(busca)) {
    const valor = um(v);
    if (valor && k !== 'erro' && k !== 'ok') q.set(k, valor);
  }
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === null || v === '') q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
