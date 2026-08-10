import { CAMPO_VOLTA, valorVolta } from '@/lib/volta';
import type { Busca } from '@/lib/pagina';

/**
 * Diz à Server Action para onde devolver o usuário.
 *
 * Sem isto a action redireciona para a rota nua e a pessoa perde a aba, o mês,
 * os filtros e o item em edição. `ancora` é o id do elemento que deve ficar
 * visível na volta — o redirect do Next rola para o topo, e a âncora é o que
 * traz a vista de volta para onde a ação aconteceu.
 */
export function Volta({ busca, ancora }: { busca: Busca; ancora?: string }) {
  return <input type="hidden" name={CAMPO_VOLTA} value={valorVolta(busca, ancora)} />;
}
