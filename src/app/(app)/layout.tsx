import Link from 'next/link';
import { Suspense } from 'react';
import { getSessao } from '@/lib/sessao';
import { listarNotificacoes } from '@/lib/data/escalas';
import { Notificacoes } from '@/components/Notificacoes';
import { createClient } from '@/lib/supabase/server';
import { NavEscalas, type GrupoNav } from '@/components/NavEscalas';
import { ROTULO_PAPEL } from '@/lib/supabase/types';
import { sair } from '@/app/actions-sessao';

/** Quantas decisões estão paradas esperando este usuário. */
async function contarPendencias(papel: string, usuarioId: string): Promise<number> {
  const supabase = await createClient();
  if (papel === 'planejamento') {
    const { count } = await supabase
      .from('solicitacoes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'TRIAGEM');
    return count ?? 0;
  }
  if (papel === 'gestor') {
    // A RLS já recorta para a equipe do gestor — basta filtrar pelo status.
    const { count } = await supabase
      .from('solicitacoes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'GESTOR');
    return count ?? 0;
  }
  const { data: eu } = await supabase.from('colaboradores').select('id').eq('perfil_id', usuarioId).maybeSingle();
  if (!eu) return 0;
  const { count } = await supabase
    .from('solicitacoes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'AGUARDA_PARCEIRO')
    .eq('parceiro_id', eu.id);
  return count ?? 0;
}

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  const [pendentes, notificacoes] = await Promise.all([
    contarPendencias(sessao.papel, sessao.usuario.id),
    listarNotificacoes(sessao.usuario.id, sessao.usuario.notificacoes_vistas_em),
  ]);

  const grupos: GrupoNav[] =
    sessao.papel === 'colaborador'
      ? [{
          secao: null,
          itens: [
            { href: '/minha-escala', label: 'Minha escala' },
            { href: '/solicitacoes', label: 'Minhas solicitações', badge: pendentes },
            { href: '/mural', label: 'Mural' },
          ],
        }]
      : sessao.papel === 'gestor'
      ? [{
          secao: 'Minha equipe',
          itens: [
            { href: '/', label: 'Indicadores' },
            { href: '/calendario', label: 'Escala' },
            { href: '/ocupacao', label: 'Ocupação' },
            { href: '/solicitacoes', label: 'Aprovações', badge: pendentes },
            { href: '/mural', label: 'Mural' },
          ],
        }]
      : [
          {
            secao: 'Operação',
            itens: [
              { href: '/planos', label: 'Planos do mês' },
              { href: '/gerar', label: 'Gerar escala' },
              { href: '/calendario', label: 'Calendário' },
              { href: '/ocupacao', label: 'Ocupação' },
              { href: '/solicitacoes', label: 'Solicitações', badge: pendentes },
              { href: '/mural', label: 'Mural' },
            ],
          },
          { secao: 'Análise', itens: [{ href: '/', label: 'Indicadores' }] },
          {
            secao: 'Cadastros',
            itens: [
              { href: '/colaboradores', label: 'Colaboradores' },
              { href: '/usuarios', label: 'Usuários' },
              { href: '/parametros', label: 'Parâmetros' },
            ],
          },
        ];

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-40 text-white border-b border-white/10"
        style={{ background: 'var(--brand-900)' }}
      >
        <div className="px-3 sm:px-4 h-12 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded bg-white/10 border border-white/20 grid place-items-center text-[9px] font-bold">
              ESC
            </div>
            <div className="leading-none hidden sm:block">
              <div className="font-semibold text-[13px] tracking-tight">Escala</div>
              <div className="text-[9.5px] text-white/50 mt-0.5 uppercase tracking-wider">{sessao.conta.nome}</div>
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Notificacoes
              itens={notificacoes.itens}
              naoLidas={notificacoes.naoLidas}
              rota="/"
            />
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-[11.5px] font-semibold">{sessao.usuario.nome}</div>
              <div className="text-[9.5px] text-white/50 uppercase tracking-wider">{ROTULO_PAPEL[sessao.papel]}</div>
            </div>
            <form action={sair}>
              <button
                type="submit"
                className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white/10 border border-white/15 hover:bg-white/20"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="px-3 sm:px-4 max-w-[1700px] mx-auto lg:flex lg:gap-1">
        <Suspense fallback={<div className="hidden lg:block w-[212px] shrink-0" />}>
          <NavEscalas grupos={grupos} />
        </Suspense>
        <main className="flex-1 min-w-0 py-4 lg:py-5 space-y-4">{children}</main>
      </div>
    </div>
  );
}
