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
 * Navegação do módulo. Abaixo de lg vira uma faixa horizontal rolável em vez de
 * sumir atrás de um menu sanduíche — quem opera escala precisa ver as seções
 * disponíveis sem descobrir que existe um botão escondido.
 */
export function NavEscalas({ grupos }: { grupos: GrupoNav[] }) {
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
      <nav className="hidden lg:block w-[212px] shrink-0" aria-label="Seções do módulo de escalas">
        <div className="sticky top-14 py-4 pr-3 space-y-5">
          {grupos.map((g, i) => (
            <div key={g.secao ?? i}>
              {g.secao && (
                <div
                  className="text-[10px] font-semibold uppercase tracking-wider px-3 mb-1.5"
                  style={{ color: 'var(--faint)' }}
                >
                  {g.secao}
                </div>
              )}
              <ul className="space-y-0.5">
                {g.itens.map(item => (
                  <li key={item.href}>
                    <Link
                      href={comMes(item.href)}
                      aria-current={ativo(item.href) ? 'page' : undefined}
                      className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[12.5px] font-medium border-l-2 transition-colors"
                      style={
                        ativo(item.href)
                          ? { background: 'var(--brand-100)', color: 'var(--brand-900)', borderLeftColor: 'var(--brand-700)', fontWeight: 600 }
                          : { color: 'var(--muted)', borderLeftColor: 'transparent' }
                      }
                    >
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className="ml-auto esc-num text-[10.5px] font-semibold px-1.5 rounded-full"
                          style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
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
              className="px-2.5 py-1.5 rounded-md text-[12px] font-semibold whitespace-nowrap"
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
