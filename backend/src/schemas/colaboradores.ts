/**
 * Validação da entrada das rotas de colaboradores.
 *
 * Existe como camada própria porque o que chega da barra de endereços é sempre
 * texto, e sempre de fora. `Number('abc')` é `NaN`, e um `NaN` que atravessa
 * até o Prisma vira um erro de banco cru na cara de quem usa — quando não vira
 * um filtro que silenciosamente não filtra.
 */
export function filtrosDaLista(bruto: unknown): { equipeId?: number; somenteAtivos?: boolean } {
  const q = (bruto ?? {}) as Record<string, unknown>;

  const equipeBruta = Number(q.equipeId);
  // Descartado em silêncio quando não é número: um filtro inválido devolve a
  // lista inteira, que é o mesmo que não filtrar — e é melhor do que recusar a
  // tela por causa de um parâmetro que alguém colou errado na URL.
  const equipeId = Number.isInteger(equipeBruta) && equipeBruta > 0 ? equipeBruta : undefined;

  return {
    ...(equipeId ? { equipeId } : {}),
    // Só a string exata liga o filtro. `Boolean('false')` é `true`, e essa
    // armadilha já custou caro em mais de um projeto.
    ...(q.somenteAtivos === 'true' ? { somenteAtivos: true } : {}),
  };
}
