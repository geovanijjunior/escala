'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MESES, partesIso, iso } from '@/lib/domain/escalas/datas';

/**
 * Seletor de competência. Escreve na query string em vez de guardar estado no
 * cliente, para que qualquer tela do módulo (e um link compartilhado) abra
 * exatamente no mesmo mês.
 */
export function SeletorMes({ competencia }: { competencia: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [ano, mes] = partesIso(competencia);

  const irPara = (nova: string) => {
    const q = new URLSearchParams(params.toString());
    q.set('competencia', nova);
    q.delete('dia');
    router.push(`${pathname}?${q.toString()}`);
  };

  const passo = (delta: number) => {
    const d = new Date(ano, mes + delta, 1);
    irPara(iso(d.getFullYear(), d.getMonth(), 1));
  };

  return (
    <div className="inline-flex items-center rounded-md border overflow-hidden" style={{ borderColor: 'var(--line-2)', background: 'var(--surface)' }}>
      <button type="button" onClick={() => passo(-1)} aria-label="Mês anterior" className="px-2 py-1.5 text-[13px]" style={{ color: 'var(--muted)' }}>
        ‹
      </button>
      <select
        value={`${mes}`}
        onChange={e => irPara(iso(ano, Number(e.target.value), 1))}
        aria-label="Mês"
        className="text-[12.5px] font-semibold px-1 py-1.5 bg-transparent outline-none cursor-pointer"
      >
        {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select
        value={`${ano}`}
        onChange={e => irPara(iso(Number(e.target.value), mes, 1))}
        aria-label="Ano"
        className="text-[12.5px] font-semibold px-1 py-1.5 bg-transparent outline-none cursor-pointer esc-num"
      >
        {Array.from({ length: 7 }, (_, i) => ano - 3 + i).map(a => <option key={a} value={a}>{a}</option>)}
      </select>
      <button type="button" onClick={() => passo(1)} aria-label="Próximo mês" className="px-2 py-1.5 text-[13px]" style={{ color: 'var(--muted)' }}>
        ›
      </button>
    </div>
  );
}
