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
 * Trilho de navegação do console.
 *
 * Escuro e de altura cheia, com a marca no topo: o menu recua para o fundo e o
 * conteúdo — que é onde se trabalha — fica sendo a única superfície clara da
 * tela. Antes o trilho era claro e disputava atenção com as tabelas.
 *
 * Abaixo de lg vira uma faixa horizontal rolável em vez de sumir atrás de um
 * menu sanduíche: quem opera escala precisa ver as seções disponíveis sem
 * descobrir que existe um botão escondido.
 */
export function NavEscalas({ grupos, marca }: { grupos: GrupoNav[]; marca?: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const competencia = params.get('competencia');

  // Preserva o mês escolhido ao trocar de tela — sem isso, cada navegação
  // devolveria o usuário ao mês corrente.
  const comMes = (href: string) => (competencia ? `${href}?competencia=${competencia}` : href);
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const todos = grupos.flatMap(g => g.itens);

  return (
    <>
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

      <div
        className="lg:hidden sticky top-12 z-30 -mx-3 px-3 border-b overflow-x-auto"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="flex gap-1 py-1.5 w-max">
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
        </div>
      </div>
    </>
  );
}
