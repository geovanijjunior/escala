'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export interface ItemNav {
  href: string;
  label: string;
  badge?: number;
}

export interface GrupoNav {
  secao: string | null;
  itens: ItemNav[];
}

/**
 * Preserva o mês escolhido ao trocar de tela — sem isso, cada navegação
 * devolveria o usuário ao mês corrente.
 */
function useNavegacao() {
  const pathname = usePathname();
  const competencia = useSearchParams().get('competencia');
  return {
    comMes: (href: string) => (competencia ? `${href}?competencia=${competencia}` : href),
    ativo: (href: string) => pathname === href || pathname.startsWith(`${href}/`),
  };
}

/**
 * Trilho de navegação do console, de `lg` para cima.
 *
 * Escuro e de altura cheia, com a marca no topo: o menu recua para o fundo e o
 * conteúdo — que é onde se trabalha — fica sendo a única superfície clara da
 * tela. Antes o trilho era claro e disputava atenção com as tabelas.
 *
 * No celular quem navega é a `FaixaSecoes`, e ela é montada à parte porque
 * precisa vir DEPOIS do cabeçalho no documento — ver o comentário lá.
 */
export function NavEscalas({
  grupos, marca,
}: { grupos: GrupoNav[]; marca?: React.ReactNode }) {
  const { comMes, ativo } = useNavegacao();

  return (
      <nav
        className="hidden lg:flex w-[230px] shrink-0 flex-col sticky top-0 h-dvh"
        style={{ background: 'var(--ink)' }}
        aria-label="Seções do sistema"
      >
        {marca && <div className="px-4 pt-4 pb-5">{marca}</div>}

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {grupos.map((g, i) => (
            <div key={g.secao ?? i}>
              {g.secao && (
                <div
                  className="px-3 mb-1.5"
                  style={{
                    fontSize: 9.5, fontWeight: 700, letterSpacing: '.15em',
                    textTransform: 'uppercase', color: 'rgba(255,255,255,.38)',
                  }}
                >
                  {g.secao}
                </div>
              )}
              <ul className="space-y-0.5">
                {g.itens.map(item => {
                  const aqui = ativo(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={comMes(item.href)}
                        aria-current={aqui ? 'page' : undefined}
                        className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12.5px] transition-colors"
                        style={
                          aqui
                            ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 }
                            : { color: 'rgba(255,255,255,.62)', fontWeight: 500 }
                        }
                      >
                        <span className="truncate">{item.label}</span>
                        {item.badge ? (
                          <span
                            className="ml-auto esc-num text-[10.5px] font-bold px-1.5 rounded-full"
                            style={
                              aqui
                                ? { background: 'rgba(255,255,255,.22)', color: '#fff' }
                                : { background: 'var(--amber)', color: '#fff' }
                            }
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
  );
}

/**
 * A navegação no celular: uma faixa horizontal rolável, abaixo do cabeçalho.
 *
 * É faixa e não menu sanduíche porque quem opera escala precisa ver as seções
 * disponíveis sem antes descobrir que existe um botão escondido.
 *
 * **Ela tem de ser montada depois do `<header>`, e dentro do mesmo container.**
 * Enquanto viveu junto do trilho — irmã ANTERIOR ao cabeçalho — o lugar dela no
 * fluxo era o topo absoluto da página, e o `sticky top-12` a colava a 48px, ou
 * seja, exatamente sob um cabeçalho de 49px e `z-40`. A faixa existia, tinha
 * altura e links, e nenhum pixel dela aparecia: ficava coberta, deixando no topo
 * um vão branco do tamanho dela. O trilho não sofria porque em `lg` o container
 * vira flex e ele ocupa a coluna da esquerda; e o colaborador não sofria porque
 * a faixa ficava `hidden` para ele, que navega pela tab bar do rodapé.
 *
 * Quem renderiza decide se ela aparece — não há prova de papel aqui dentro. O
 * colaborador simplesmente não a monta: repetir os quatro destinos da tab bar
 * numa faixa no topo seria menu em dobro.
 */
export function FaixaSecoes({ grupos }: { grupos: GrupoNav[] }) {
  const { comMes, ativo } = useNavegacao();
  const todos = grupos.flatMap(g => g.itens);

  // `top-[49px]` e não `top-12`: o cabeçalho do celular tem 48 de altura MAIS a
  // borda de baixo. Colar a faixa em 48 deixava a primeira linha dela sob essa
  // borda ao rolar.
  return (
    <div
      className="lg:hidden sticky top-[49px] z-30 px-3 sm:px-5 border-b overflow-x-auto"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <nav className="flex gap-1 py-1.5 w-max" aria-label="Seções do sistema">
        {todos.map(item => (
          <Link
            key={item.href}
            href={comMes(item.href)}
            aria-current={ativo(item.href) ? 'page' : undefined}
            className="px-2.5 py-1.5 rounded-[9px] text-[12px] font-semibold whitespace-nowrap"
            style={
              ativo(item.href)
                ? { background: 'var(--brand-100)', color: 'var(--brand-900)' }
                : { color: 'var(--muted)' }
            }
          >
            {item.label}
            {item.badge ? <span className="ml-1 esc-num" style={{ color: 'var(--amber)' }}>{item.badge}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
