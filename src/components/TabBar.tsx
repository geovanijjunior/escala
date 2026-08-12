'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export interface AbaTab {
  href: string;
  label: string;
  /** Ponto vermelho: há novidade aqui. Não é contagem — é "olhe isto". */
  novidade?: boolean;
}

/**
 * Barra de abas do app do colaborador, no rodapé, só no celular.
 *
 * O colaborador usa isto no ônibus, com uma mão, para responder "onde eu
 * trabalho hoje". A faixa horizontal rolável do console servia ao Planejamento
 * — dez seções que precisam caber — e aqui virava um menu de quatro itens que
 * mesmo assim exigia mirar. No rodapé os quatro destinos ficam sob o polegar, e
 * cada alvo tem 44px, que é o mínimo para acertar em movimento.
 *
 * O ícone é geométrico de propósito: um quadrado que muda de forma por aba,
 * feito com CSS. Uma biblioteca de ícones aqui seriam 40 KB para desenhar
 * quatro figuras.
 */
export function TabBar({ abas }: { abas: AbaTab[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const competencia = params.get('competencia');
  const comMes = (href: string) => (competencia ? `${href}?competencia=${competencia}` : href);
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Seções"
    >
      <ul className="grid grid-cols-4">
        {abas.map((a, i) => {
          const aqui = ativo(a.href);
          return (
            <li key={a.href}>
              <Link
                href={comMes(a.href)}
                aria-current={aqui ? 'page' : undefined}
                className="flex flex-col items-center justify-center gap-1 min-h-[56px] px-1 py-2"
              >
                <span className="relative grid place-items-center w-[38px] h-[26px] rounded-[9px]"
                  style={aqui ? { background: '#F0F5FF' } : undefined}
                >
                  <span
                    style={{
                      width: 13, height: 13,
                      borderRadius: i === 2 ? 999 : i === 1 ? 4 : 3,
                      background: aqui ? 'var(--accent)' : 'transparent',
                      border: aqui ? 'none' : `2px solid var(--faint-2)`,
                    }}
                  />
                  {a.novidade && (
                    <span
                      className="absolute -top-0.5 right-1 w-[7px] h-[7px] rounded-full"
                      style={{ background: '#E11D48' }}
                    />
                  )}
                </span>
                <span
                  className="text-[10.5px] leading-none"
                  style={{ color: aqui ? 'var(--accent)' : 'var(--muted)', fontWeight: aqui ? 700 : 500 }}
                >
                  {a.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
