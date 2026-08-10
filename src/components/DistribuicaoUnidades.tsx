'use client';

import { useState } from 'react';
import type { Unidade } from '@/lib/domain/escalas/tipos';

/**
 * Seletor da distribuição percentual entre unidades.
 *
 * Só aceita os degraus configurados (0/25/50/75/100) e, quando há exatamente
 * duas unidades, escolher uma já define a outra — o par sempre fecha em 100 sem
 * que o usuário precise fazer a conta. Com três ou mais, o total aparece ao vivo
 * e o formulário só libera o envio quando bate 100.
 */
export function DistribuicaoUnidades({
  unidades, valores, degraus,
}: { unidades: Unidade[]; valores: Record<number, number>; degraus: number[] }) {
  const [pcts, setPcts] = useState<Record<number, number>>(() =>
    Object.fromEntries(unidades.map(u => [u.id, valores[u.id] ?? 0]))
  );

  const soma = unidades.reduce((acc, u) => acc + (pcts[u.id] ?? 0), 0);
  const par = unidades.length === 2;

  const definir = (unidadeId: number, valor: number) => {
    if (par) {
      const outra = unidades.find(u => u.id !== unidadeId)!;
      setPcts({ [unidadeId]: valor, [outra.id]: 100 - valor });
    } else {
      setPcts(p => ({ ...p, [unidadeId]: valor }));
    }
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="esc-rotulo mb-0">Distribuição dos dias presenciais</span>
        <span
          className="text-[11.5px] font-semibold esc-num"
          style={{ color: soma === 100 ? 'var(--green)' : 'var(--rose)' }}
        >
          Total {soma}%
        </span>
      </div>

      <div className="space-y-2">
        {unidades.map(u => (
          <div key={u.id} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name={`dist_${u.id}`} value={pcts[u.id] ?? 0} />
            <span className="text-[12.5px] font-medium w-32 shrink-0" style={{ color: u.cor }}>{u.nome}</span>
            <div className="flex gap-1">
              {degraus.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => definir(u.id, d)}
                  aria-pressed={pcts[u.id] === d}
                  className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold border esc-num"
                  style={
                    pcts[u.id] === d
                      ? { background: u.cor, color: '#fff', borderColor: u.cor }
                      : { background: 'var(--surface)', color: 'var(--muted)', borderColor: 'var(--line-2)' }
                  }
                >
                  {d}%
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {soma !== 100 && (
        <p className="text-[11.5px] mt-1.5 font-medium" style={{ color: 'var(--rose)' }}>
          A distribuição precisa somar exatamente 100% para o plano ser salvo.
        </p>
      )}
    </section>
  );
}
