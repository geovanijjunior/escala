import type { Ciclo } from './tipos';

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
export const DIAS_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_INICIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Monta um ISO a partir de ano/mês(0-11)/dia sem passar por Date — evita fuso. */
export function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${pad(mes + 1)}-${pad(dia)}`;
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes + 1, 0).getDate();
}

export function diaSemana(ano: number, mes: number, dia: number): number {
  return new Date(ano, mes, dia).getDay();
}

export function partesIso(data: string): [number, number, number] {
  const [a, m, d] = data.split('-').map(Number);
  return [a, m - 1, d];
}

export function dowDeIso(data: string): number {
  const [a, m, d] = partesIso(data);
  return new Date(a, m, d).getDay();
}

export function addDias(data: string, n: number): string {
  const [a, m, d] = partesIso(data);
  const dt = new Date(a, m, d + n);
  return iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/** Dias corridos entre duas datas ISO (b - a). Usa UTC pra não sofrer com horário de verão. */
export function diffDias(a: string, b: string): number {
  const [ay, am, ad] = partesIso(a);
  const [by, bm, bd] = partesIso(b);
  return Math.round((Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad)) / 86400000);
}

export function competenciaDe(ano: number, mes: number): string {
  return iso(ano, mes, 1);
}

export function formatarData(data: string): string {
  return data.split('-').reverse().join('/');
}

export function formatarCompetencia(competencia: string): string {
  const [ano, mes] = partesIso(competencia);
  return `${MESES[mes]} ${ano}`;
}

/** Soma horas a um "HH:MM", com volta na virada do dia. */
export function somaHoras(hhmm: string, horas: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + Math.round(horas * 60);
  const norm = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(norm / 60))}:${pad(norm % 60)}`;
}

/** Último dia coberto por uma ausência de N dias corridos. */
export function fimAusencia(inicio: string, dias: number): string {
  return addDias(inicio, Math.max(1, dias) - 1);
}

export function intervalosSobrepoem(aIni: string, aFim: string, bIni: string, bFim: string): boolean {
  return aIni <= bFim && bIni <= aFim;
}

/**
 * Ciclo efetivo do 12x36 num mês, derivado da paridade dos dias decorridos
 * desde o mês âncora.
 *
 * O protótipo resolvia isso contando quantos meses anteriores tinham 31 dias e
 * invertendo par/ímpar a cada ocorrência, com o ano de 2026 fixo no código. O
 * resultado é o mesmo (só mês de tamanho ímpar troca a paridade), mas contar
 * dias direto é exato para qualquer âncora, funciona pra trás e não depende de
 * varrer mês a mês.
 */
export function cicloEfetivo(cicloBase: Ciclo, competencia: string, ancora: string): Ciclo {
  const delta = diffDias(ancora, competencia);
  const inverte = Math.abs(delta) % 2 === 1;
  if (!inverte) return cicloBase;
  return cicloBase === 'IMPAR' ? 'PAR' : 'IMPAR';
}
