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
/**
 * Um número do mês, com o contexto que o torna legível.
 *
 * `destaque` inverte o cartão para o azul da marca. É para o KPI acionável —
 * aquele em que se clica, não aquele que se lê. Num grid de quatro cartões
 * iguais, o que exige ação desaparece entre os que só informam; um deles em
 * negativo resolve isso sem precisar de seta nem de cor de alerta, que aqui já
 * significam outra coisa.
 *
 * `delta` é a variação contra o período anterior, ao lado do número e não
 * embaixo: é leitura de relance, não de estudo.
 */
export function Stat({
  label, valor, sub, cor, alerta, delta, deltaCor, barra, destaque,
}: {
  label: string; valor: ReactNode; sub?: string; cor?: string; alerta?: boolean;
  delta?: string; deltaCor?: string;
  /** Proporção de 0 a 1. Desenha a barra fina sob o número. */
  barra?: number;
  destaque?: boolean;
}) {
  const tinta = destaque ? '#fff' : 'var(--text)';
  const apoio = destaque ? 'rgba(255,255,255,.62)' : 'var(--muted)';

  return (
    <div
      className={destaque ? 'rounded-[14px] px-4 py-3.5' : 'esc-card px-4 py-3.5'}
      style={{
        ...(destaque ? { background: 'var(--brand-900)' } : {}),
        ...(alerta && !destaque ? { borderLeft: `3px solid ${cor ?? 'var(--brand-700)'}` } : {}),
      }}
    >
      <div
        className="mb-1.5 truncate"
        style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
          color: destaque ? 'rgba(255,255,255,.6)' : 'var(--faint)',
        }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className="text-[28px] leading-none font-bold esc-num"
          style={{ color: tinta, letterSpacing: '-.03em' }}
        >
          {valor}
        </span>
        {delta && (
          <span className="text-[11px] font-semibold esc-num" style={{ color: deltaCor ?? apoio }}>
            {delta}
          </span>
        )}
      </div>
      {barra !== undefined && (
        <div
          className="mt-2 h-[5px] rounded-full overflow-hidden"
          style={{ background: destaque ? 'rgba(255,255,255,.18)' : 'var(--line-soft)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(1, barra)) * 100}%`,
              background: destaque ? '#fff' : 'var(--accent)',
            }}
          />
        </div>
      )}
      {sub && <div className="text-[11px] mt-1.5 leading-tight" style={{ color: apoio }}>{sub}</div>}
    </div>
  );
}

/**
 * Rótulo que numera e nomeia uma faixa da tela.
 *
 * Uma pilha de cartões não diz por onde começar. Numerar as faixas dá ordem de
 * leitura: 1 é como o mês está, 2 é onde ele aperta, 3 é o detalhe pessoa a
 * pessoa. Quem chega sabendo o que procura pula direto para a faixa certa.
 */
export function Faixa({ n, children }: { n: number; children: ReactNode }) {
  return <div className="esc-faixa mt-1" data-n={n}>{children}</div>;
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
      {/* `ok=1` é o valor genérico que a maioria das actions manda; qualquer
          outro texto é uma mensagem específica e vale mais do que o padrão. */}
      {erro ?? (ok && ok !== '1' ? ok : 'Alteração salva.')}
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
