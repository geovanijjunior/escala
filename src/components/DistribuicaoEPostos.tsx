'use client';

import { useState } from 'react';
import { DistribuicaoUnidades } from './DistribuicaoUnidades';
import { PostosDoPlano } from './PostosDoPlano';
import type { Posto, PostoDoPlano, Unidade } from '@/lib/domain/escalas/tipos';

/**
 * Dono do percentual por unidade, porque duas seções dependem dele.
 *
 * A pergunta "fica no Corpo Clínico?" só faz sentido se a distribuição mandar a
 * pessoa ao Morumbi, então os postos oferecidos mudam conforme os percentuais.
 * A primeira versão lia os campos direto do DOM e errava duas vezes: pegava o
 * primeiro <form> do documento — o de sair, que vive no cabeçalho — e escutava
 * `change`, que os botões de degrau nunca disparam. O estado compartilhado
 * elimina as duas fragilidades.
 */
export function DistribuicaoEPostos({
  unidades, valores, degraus, postos, atribuidos,
}: {
  unidades: Unidade[];
  valores: Record<number, number>;
  degraus: number[];
  postos: Posto[];
  atribuidos: PostoDoPlano[];
}) {
  const [pcts, setPcts] = useState<Record<number, number>>(() =>
    Object.fromEntries(unidades.map(u => [u.id, valores[u.id] ?? 0]))
  );

  const mudar = (unidadeId: number, valor: number) => {
    // Com duas unidades, escolher uma já define a outra: o par fecha em 100 sem
    // obrigar quem preenche a fazer a conta.
    if (unidades.length === 2) {
      const outra = unidades.find(u => u.id !== unidadeId)!;
      setPcts({ [unidadeId]: valor, [outra.id]: 100 - valor });
    } else {
      setPcts(p => ({ ...p, [unidadeId]: valor }));
    }
  };

  return (
    <>
      <DistribuicaoUnidades unidades={unidades} pcts={pcts} onMudar={mudar} degraus={degraus} />
      <PostosDoPlano postos={postos} unidades={unidades} atribuidos={atribuidos} distribuicao={pcts} />
    </>
  );
}
