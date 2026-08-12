import Link from 'next/link';
import { Suspense } from 'react';
import { getSessaoGeral } from '@/lib/sessao';
import { NavEscalas } from '@/components/NavEscalas';
import { Marca } from '@/components/Marca';
import { ROTULO_PAPEL } from '@/lib/supabase/types';
import { sair } from '@/app/actions-sessao';

/**
 * O console do sistema, separado do console de escala.
 *
 * Precisa ser um grupo de rotas próprio porque o layout de `(app)` chama
 * `getSessao()`, e `getSessao()` exige uma conta — que é justamente o que o
 * Administrador Geral não tem. Um layout compartilhado com `conta` opcional
 * espalharia um `?.` por cada tela de escala para acomodar um papel que nunca
 * as abre.
 *
 * Visualmente é o mesmo console: mesmo trilho escuro, mesma topbar. O que muda
 * é o descritor da marca — "Sistema" no lugar do nome da área —, e é ele que
 * diz, num relance, que esta aba não está dentro de organização nenhuma.
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const sessao = await getSessaoGeral();

  const iniciais = sessao.usuario.nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-dvh lg:flex">
      <Suspense fallback={<div className="hidden lg:block w-[230px] shrink-0" style={{ background: 'var(--ink)' }} />}>
        <NavEscalas
          grupos={[{ secao: 'Sistema', itens: [{ href: '/areas', label: 'Áreas' }] }]}
          marca={
            <Link href="/areas" className="block text-white">
              <Marca descritor="Sistema" tamanho={34} />
            </Link>
          }
        />
      </Suspense>

      <div className="flex-1 min-w-0">
        <header
          className="sticky top-0 z-40 border-b"
          style={{ background: 'var(--brand-900)', borderColor: 'rgba(255,255,255,.10)' }}
        >
          <div className="px-3 sm:px-4 h-12 flex items-center gap-3 lg:hidden text-white">
            <Link href="/areas" className="shrink-0">
              <Marca descritor="Sistema" tamanho={28} />
            </Link>
            <form action={sair} className="ml-auto">
              <button
                type="submit"
                className="text-[11px] font-semibold px-2 py-1 rounded-[9px] bg-white/10 border border-white/15 hover:bg-white/20"
              >
                Sair
              </button>
            </form>
          </div>

          <div className="hidden lg:flex items-center gap-3 h-[60px] px-5" style={{ background: 'var(--surface)' }}>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right leading-tight">
                <div className="text-[12px] font-semibold">{sessao.usuario.nome}</div>
                <div className="text-[9.5px] uppercase tracking-[.12em]" style={{ color: 'var(--faint)' }}>
                  {ROTULO_PAPEL.admin_geral}
                </div>
              </div>
              <div
                className="w-9 h-9 rounded-[11px] grid place-items-center text-[12px] font-bold"
                style={{ background: 'var(--brand-100)', color: 'var(--brand-900)' }}
                aria-hidden
              >
                {iniciais}
              </div>
              <form action={sair}>
                <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">Sair</button>
              </form>
            </div>
          </div>
        </header>

        <main className="px-3 sm:px-5 max-w-[1560px] py-4 lg:py-5 space-y-4">{children}</main>
      </div>
    </div>
  );
}
