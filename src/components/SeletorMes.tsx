'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MESES, partesIso, iso } from '@/lib/domain/escalas/datas';

/**
 * Seletor de competência. Escreve na query string em vez de guardar estado no
 * cliente, para que qualquer tela do módulo (e um link compartilhado) abra
 * exatamente no mesmo mês.
 *
 * Decisões de interface que valem registrar:
 *
 * - As setas são alvos de 36px com hover e foco visíveis. Antes eram glifos de
 *   13px em cinza claro numa área de 24px — abaixo do mínimo de toque e quase
 *   invisíveis ao lado do texto em negrito.
 * - O nome do mês tem largura fixa. Sem isso o controle inteiro muda de tamanho
 *   ao passar de "Maio" para "Setembro", e as setas fogem do dedo entre um
 *   clique e o outro.
 * - Um chevron só, no fim do grupo, em vez de um por select nativo: os dois
 *   juntos liam como dois controles desconexos.
 * - "Hoje" só aparece fora do mês corrente, que é quando ele tem utilidade.
 */
export function SeletorMes({ competencia }: { competencia: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [ano, mes] = partesIso(competencia);

  const hoje = new Date();
  const noMesAtual = ano === hoje.getFullYear() && mes === hoje.getMonth();

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

  const anos = Array.from({ length: 7 }, (_, i) => ano - 3 + i);

  const seta = 'grid place-items-center w-9 h-9 shrink-0 transition-colors '
    + 'hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
    + 'focus-visible:outline-[var(--brand-600)]';

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="inline-flex items-stretch rounded-lg border overflow-hidden"
        style={{ borderColor: 'var(--line-2)', background: 'var(--surface)' }}
      >
        <button
          type="button"
          onClick={() => passo(-1)}
          aria-label={`Mês anterior — ${MESES[(mes + 11) % 12]}`}
          className={`${seta} border-r`}
          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
        >
          <Chevron direcao="esquerda" />
        </button>

        {/* O select cobre o rótulo por inteiro: o clique cai em qualquer ponto
            do nome do mês, não só num chevron de 10px. */}
        <div className="relative flex items-center">
          <span
            className="text-[12.5px] font-semibold pl-3 pr-1 w-[96px] text-right select-none"
            aria-hidden
          >
            {MESES[mes]}
          </span>
          {/* Sem o chevron, o nome do mês parece rótulo e ninguém descobre que
              abre a lista — o ano ao lado teria a única pista de interação. */}
          <span aria-hidden className="pr-2.5" style={{ color: 'var(--muted)' }}>
            <Chevron direcao="baixo" />
          </span>
          <select
            value={mes}
            onChange={e => irPara(iso(ano, Number(e.target.value), 1))}
            aria-label="Mês"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>

        <div className="relative flex items-center border-l" style={{ borderColor: 'var(--line)' }}>
          <span className="text-[12.5px] font-semibold esc-num pl-3 pr-1.5 select-none" aria-hidden>
            {ano}
          </span>
          <span aria-hidden className="pr-2.5" style={{ color: 'var(--muted)' }}>
            <Chevron direcao="baixo" />
          </span>
          <select
            value={ano}
            onChange={e => irPara(iso(Number(e.target.value), mes, 1))}
            aria-label="Ano"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <button
          type="button"
          onClick={() => passo(1)}
          aria-label={`Próximo mês — ${MESES[(mes + 1) % 12]}`}
          className={`${seta} border-l`}
          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
        >
          <Chevron direcao="direita" />
        </button>
      </div>

      {!noMesAtual && (
        <button
          type="button"
          onClick={() => irPara(iso(hoje.getFullYear(), hoje.getMonth(), 1))}
          className="esc-btn esc-btn-outline esc-btn-sm"
        >
          Hoje
        </button>
      )}
    </div>
  );
}

function Chevron({ direcao }: { direcao: 'esquerda' | 'direita' | 'baixo' }) {
  const d = direcao === 'esquerda' ? 'M9.5 3 5 7.5 9.5 12'
    : direcao === 'direita' ? 'M5.5 3 10 7.5 5.5 12'
    : 'M3 5.5 7 9.5 11 5.5';
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden focusable="false">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
