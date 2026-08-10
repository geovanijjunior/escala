import Link from 'next/link';
import type { ReactNode } from 'react';
import { MODALIDADES } from '@/lib/domain/escalas/constantes';
import type { Modalidade, Unidade } from '@/lib/domain/escalas/tipos';

/**
 * Bloco padrão: título, descrição opcional e ações à direita.
 *
 * `id` serve de âncora para o retorno das Server Actions — o redirect do Next
 * rola para o topo, e sem um alvo a linha recém-salva sai da vista.
 * `scroll-mt` compensa o cabeçalho fixo, senão a âncora para atrás dele.
 */
export function Bloco({
  id, titulo, desc, acoes, children, className = '',
}: { id?: string; titulo?: string; desc?: string; acoes?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section id={id} className={`esc-card scroll-mt-20 ${className}`}>
      {(titulo || acoes) && (
        <div className="esc-bloco-topo">
          <div className="min-w-0">
            {titulo && <h3 className="esc-titulo">{titulo}</h3>}
            {desc && <p className="esc-desc">{desc}</p>}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-2 shrink-0">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, cor, bg }: { children: ReactNode; cor: string; bg: string }) {
  return <span className="esc-badge" style={{ color: cor, background: bg }}>{children}</span>;
}

export function Pill({ children, cor, bg }: { children: ReactNode; cor: string; bg: string }) {
  return <span className="esc-pill" style={{ color: cor, background: bg }}>{children}</span>;
}

/** KPI: rótulo micro, número dominante, contexto abaixo. */
export function Stat({
  label, valor, sub, cor, alerta,
}: { label: string; valor: ReactNode; sub?: string; cor?: string; alerta?: boolean }) {
  return (
    <div
      className="esc-card px-4 py-3.5"
      style={alerta ? { borderLeft: `3px solid ${cor ?? 'var(--brand-700)'}` } : undefined}
    >
      <div className="esc-rotulo mb-1.5 truncate">{label}</div>
      <div className="text-[26px] leading-none font-semibold esc-num tracking-tight">{valor}</div>
      {sub && <div className="text-[10.5px] mt-1.5 leading-tight" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

/** Aparência de uma alocação: unidade física ou modalidade não-presencial. */
export function aparencia(modalidade: Modalidade, unidadeId: number | null, unidades: Unidade[]) {
  if (modalidade === 'UNIDADE') {
    const u = unidades.find(x => x.id === unidadeId);
    return { label: u?.nome ?? 'Unidade', sigla: u?.sigla ?? '?', cor: u?.cor ?? '#1A4E93', bg: u?.bg ?? '#DCEAF8' };
  }
  const m = MODALIDADES[modalidade];
  return { label: m.label, sigla: m.sigla, cor: m.cor, bg: m.bg };
}

export function BadgeAlocacao({
  modalidade, unidadeId, unidades, compacto,
}: { modalidade: Modalidade; unidadeId: number | null; unidades: Unidade[]; compacto?: boolean }) {
  const a = aparencia(modalidade, unidadeId, unidades);
  return <Badge cor={a.cor} bg={a.bg}>{compacto ? a.sigla : a.label}</Badge>;
}

export function Vazio({ titulo, desc, acao }: { titulo: string; desc: string; acao?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div
        className="w-11 h-11 rounded-full grid place-items-center mx-auto mb-3 text-[18px]"
        style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}
        aria-hidden
      >
        ◔
      </div>
      <p className="text-[13.5px] font-semibold">{titulo}</p>
      <p className="text-[12px] mt-1 max-w-md mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>{desc}</p>
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  );
}

/** Faixa de erro/sucesso vinda da query string das Server Actions. */
export function Aviso({ erro, ok }: { erro?: string; ok?: string }) {
  if (!erro && !ok) return null;
  const sucesso = !erro;
  return (
    <div
      className="esc-card px-4 py-2.5 text-[12.5px] font-medium"
      style={{
        borderLeft: `3px solid ${sucesso ? 'var(--green)' : 'var(--rose)'}`,
        background: sucesso ? 'var(--green-bg)' : 'var(--rose-bg)',
        color: sucesso ? 'var(--green)' : 'var(--rose)',
      }}
      role="status"
    >
      {erro ?? 'Alteração salva.'}
    </div>
  );
}

/** Abas navegáveis por link — o estado vive na URL, então sobrevive ao refresh. */
export function Abas({
  itens, ativa,
}: { itens: { chave: string; label: string; href: string; extra?: number }[]; ativa: string }) {
  return (
    <div
      className="inline-flex p-0.5 rounded-lg border overflow-x-auto max-w-full"
      style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
      role="tablist"
    >
      {itens.map(i => (
        <Link key={i.chave} href={i.href} role="tab" aria-selected={ativa === i.chave} className="esc-aba" data-ativa={ativa === i.chave}>
          {i.label}
          {i.extra !== undefined && <span className="ml-1.5 esc-num" style={{ color: 'var(--faint)' }}>{i.extra}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Lista de conflitos e alertas do motor, com o bloqueante em destaque. */
export function ListaAvisos({ itens, limite = 40 }: { itens: { nivel: 'erro' | 'aviso'; colaborador?: string; data?: string; msg: string }[]; limite?: number }) {
  if (itens.length === 0) {
    return (
      <p className="px-4 py-6 text-[12.5px] text-center" style={{ color: 'var(--muted)' }}>
        Nenhum conflito ou alerta nesta geração.
      </p>
    );
  }
  const ordenados = [...itens].sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'erro' ? -1 : 1));
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
      {ordenados.slice(0, limite).map((a, i) => (
        <li key={i} className="px-4 py-2.5 flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0">
            <Badge
              cor={a.nivel === 'erro' ? 'var(--rose)' : 'var(--amber)'}
              bg={a.nivel === 'erro' ? 'var(--rose-bg)' : 'var(--amber-bg)'}
            >
              {a.nivel === 'erro' ? 'Bloqueante' : 'Aviso'}
            </Badge>
          </span>
          <span className="text-[12px] leading-snug">
            {a.colaborador && <strong className="font-semibold">{a.colaborador} · </strong>}
            {a.msg}
          </span>
        </li>
      ))}
      {ordenados.length > limite && (
        <li className="px-4 py-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          e mais {ordenados.length - limite} item(ns).
        </li>
      )}
    </ul>
  );
}

/** Barra de ocupação de uma unidade num dia. Vermelho quando lota. */
export function BarraOcupacao({ ocupado, capacidade, cor }: { ocupado: number; capacidade: number; cor: string }) {
  const pct = capacidade > 0 ? Math.min(100, (ocupado / capacidade) * 100) : 0;
  const lotado = capacidade > 0 && ocupado >= capacidade;
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: lotado ? 'var(--rose)' : cor }} />
    </div>
  );
}
