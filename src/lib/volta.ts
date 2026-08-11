import { redirect } from 'next/navigation';
import type { Busca } from '@/lib/pagina';

/**
 * Preserva o contexto da tela através de uma Server Action.
 *
 * As actions redirecionavam para a rota crua (`/parametros?ok=1`), o que jogava
 * fora tudo que dizia onde o usuário estava: aba aberta, mês, filtros, item em
 * edição. Salvar uma equipe devolvia a pessoa à aba Unidades — a gravação
 * acontecia, mas nada do resultado ficava visível, o que se lê como "não
 * funciona". A âncora resolve a segunda metade: o `redirect` do Next sempre
 * rola para o topo, e sem ela a linha recém-criada some da vista.
 *
 * O valor vem do cliente, então nunca é usado como caminho — só a query string
 * e a âncora são aproveitadas, sempre coladas numa rota fixa do servidor.
 */
export const CAMPO_VOLTA = '_volta';

/** Valor do campo oculto: a query string atual mais a âncora de destino. */
export function valorVolta(busca: Busca, ancora?: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(busca)) {
    const valor = Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
    if (valor && k !== 'erro' && k !== 'ok' && k !== CAMPO_VOLTA) q.set(k, valor);
  }
  const s = q.toString();
  return `${s ? `?${s}` : ''}${ancora ? `#${ancora}` : ''}`;
}

function montar(rota: string, formData: FormData, extras: Record<string, string>): string {
  const bruto = String(formData.get(CAMPO_VOLTA) ?? '');
  const [qs = '', ancora] = bruto.split('#');

  // URLSearchParams sobre o trecho depois do "?" — qualquer coisa que não seja
  // par chave=valor vira um nome de parâmetro escapado, nunca um caminho novo.
  const q = new URLSearchParams(qs.replace(/^\?/, ''));
  q.delete('erro');
  q.delete('ok');
  for (const [k, v] of Object.entries(extras)) {
    if (v === '') q.delete(k);
    else q.set(k, v);
  }

  const s = q.toString();
  return `${rota}${s ? `?${s}` : ''}${ancora ? `#${ancora}` : ''}`;
}

/** Volta para a tela de origem com o contexto intacto. */
export function voltar(rota: string, formData: FormData, extras: Record<string, string> = {}): never {
  redirect(montar(rota, formData, { ok: '1', ...extras }));
}

/** Volta para a tela de origem mostrando um erro, sem perder o que estava aberto. */
export function voltarComErro(rota: string, formData: FormData, msg: string): never {
  redirect(montar(rota, formData, { erro: msg }));
}

/**
 * Acrescenta `erro` a uma rota que já pode trazer query string e âncora.
 *
 * As actions de geração e de solicitações montavam `${rota}?erro=…` na mão, e a
 * rota de retorno quase sempre já tinha um `?`. O resultado,
 * `/gerar?competencia=2026-11-01?erro=…`, não mostrava erro nenhum: o segundo
 * `?` entra no VALOR de `competencia`, que deixa de casar com o formato
 * esperado — então a mensagem some e a tela ainda pula para o mês corrente.
 * Falha silenciosa em cima de falha silenciosa.
 */
export function rotaComErro(rota: string, msg: string): string {
  const corte = rota.indexOf('#');
  const ancora = corte >= 0 ? rota.slice(corte) : '';
  const semAncora = corte >= 0 ? rota.slice(0, corte) : rota;

  const inicio = semAncora.indexOf('?');
  const caminho = inicio >= 0 ? semAncora.slice(0, inicio) : semAncora;
  const q = new URLSearchParams(inicio >= 0 ? semAncora.slice(inicio + 1) : '');
  q.set('erro', msg);

  return `${caminho}?${q.toString()}${ancora}`;
}
