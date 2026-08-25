import Link from 'next/link';
import { Suspense } from 'react';
import { getSessao } from '@/lib/sessao';
import { listarNotificacoes } from '@/lib/data/escalas';
import { Notificacoes } from '@/components/Notificacoes';
import { createClient } from '@/lib/supabase/server';
import { NavEscalas, FaixaSecoes, type GrupoNav } from '@/components/NavEscalas';
import { Marca } from '@/components/Marca';
import { TabBar } from '@/components/TabBar';
import { PreservarRolagem } from '@/components/PreservarRolagem';
import { ROTULO_PAPEL } from '@/lib/supabase/types';
import { sair } from '@/app/actions-sessao';

/** Quantas decisões estão paradas esperando este usuário. */
async function contarPendencias(papel: string, usuarioId: string): Promise<number> {
  // O Administrador da Área não decide solicitação — nada fica parado nele.
  if (papel === 'admin_local') return 0;

  const supabase = await createClient();
  if (papel === 'planejamento') {
    // Triagem é o que espera decisão; IMPLANTAR é o que espera trabalho — o
    // pedido que ele mesmo abriu, o gestor aprovou, e agora precisa entrar na
    // escala. Os dois param nele, então os dois contam: fora do contador, o que
    // volta do gestor não avisa ninguém de que voltou.
    const { count } = await supabase
      .from('solicitacoes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['TRIAGEM', 'IMPLANTAR']);
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

/**
 * Comunicados publicados desde a última vez que a pessoa abriu o mural.
 *
 * A RLS já recorta o mural por papel e por equipe, então a contagem não repete
 * esse filtro — repetir seria a chance de os dois discordarem, e o menu
 * anunciar um comunicado que a tela não mostra.
 */
async function contarMuralNovo(muralVistoEm: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('comunicados')
    .select('id', { count: 'exact', head: true })
    .gt('criado_em', muralVistoEm);
  return count ?? 0;
}

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  const [pendentes, muralNovo, notificacoes] = await Promise.all([
    contarPendencias(sessao.papel, sessao.usuario.id),
    contarMuralNovo(sessao.usuario.mural_visto_em),
    listarNotificacoes(sessao.usuario.id, sessao.usuario.notificacoes_vistas_em),
  ]);

  const ehColaborador = sessao.papel === 'colaborador';

  const grupos: GrupoNav[] =
    sessao.papel === 'colaborador'
      ? [{
          secao: null,
          itens: [
            { href: '/hoje', label: 'Hoje' },
            { href: '/minha-escala', label: 'Minha escala' },
            { href: '/solicitacoes', label: 'Minhas solicitações', badge: pendentes },
            { href: '/mural', label: 'Mural', badge: muralNovo },
          ],
        }]
      : sessao.papel === 'admin_local'
      ? [
          // Sem Planos, Gerar, Calendário nem Solicitações: quem responde pela
          // área monta a área, não o mês. Os indicadores ficam porque são
          // leitura — é como ele confere se a operação que ele configurou está
          // de pé, sem tocar em nada dela.
          { secao: 'Área', itens: [{ href: '/', label: 'Indicadores' }] },
          {
            secao: 'Cadastros',
            itens: [
              { href: '/usuarios', label: 'Usuários' },
              { href: '/parametros', label: 'Parâmetros' },
            ],
          },
        ]
      : sessao.papel === 'gestor'
      ? [{
          secao: 'Minha equipe',
          itens: [
            { href: '/', label: 'Indicadores' },
            { href: '/calendario', label: 'Escala' },
            { href: '/ocupacao', label: 'Ocupação' },
            { href: '/solicitacoes', label: 'Aprovações', badge: pendentes },
            { href: '/mural', label: 'Mural', badge: muralNovo },
          ],
        }]
      : [
          {
            secao: 'Operação',
            itens: [
              // Um destino só para montar o mês. "Planos do mês" e "Gerar
              // escala" eram duas entradas de menu para etapas do mesmo
              // trabalho, e a ordem entre elas não aparecia em lugar nenhum da
              // tela. As quatro etapas passaram a morar em /gerar; /planos
              // redireciona para a primeira delas.
              { href: '/gerar', label: 'Montar a escala' },
              { href: '/calendario', label: 'Calendário' },
              { href: '/ocupacao', label: 'Ocupação' },
              { href: '/solicitacoes', label: 'Solicitações', badge: pendentes },
              { href: '/mural', label: 'Mural', badge: muralNovo },
            ],
          },
          { secao: 'Análise', itens: [{ href: '/', label: 'Indicadores' }] },
          {
            secao: 'Cadastros',
            itens: [
              // Colaboradores saiu do menu: eram duas portas para cadastrar a
              // mesma pessoa, e quem entrava pela errada esbarrava no cadastro
              // feito pela outra. Agora o caminho é um só — Usuários cria o
              // acesso e a ficha da escala juntos. A tela de Colaboradores
              // continua existindo, alcançável a partir de Usuários, porque é
              // onde se edita a ficha de quem já existe e onde vive a
              // importação por planilha.
              { href: '/usuarios', label: 'Usuários' },
              { href: '/parametros', label: 'Parâmetros' },
            ],
          },
        ];

  const iniciais = sessao.usuario.nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Não desenha nada: só devolve a rolagem ao lugar depois de cada action.
          Dentro de um Suspense porque lê a query string, e sem a fronteira a
          árvore de cliente acima dele deixaria de ser pré-renderizada. */}
      <Suspense fallback={null}>
        <PreservarRolagem />
      </Suspense>

      <Suspense fallback={<div className="hidden lg:block w-[230px] shrink-0" style={{ background: 'var(--ink)' }} />}>
        <NavEscalas
          grupos={grupos}
          marca={
            <Link href="/" className="block text-white">
              {/* O descritor é o nome da conta, e não "gestão de equipes": com
                  duas abas abertas, o que distingue uma da outra é o hospital. */}
              <Marca descritor={sessao.conta.nome} tamanho={34} />
            </Link>
          }
        />
      </Suspense>

      <div className="flex-1 min-w-0">
        {/* No celular o trilho não cabe, então a marca volta para uma barra
            escura no topo. No desktop ela vive no trilho, e esta barra fica
            branca — o contraste some do topo e sobra para o conteúdo. */}
        <header
          className="sticky top-0 z-40 border-b"
          style={{ background: 'var(--brand-900)', borderColor: 'rgba(255,255,255,.10)' }}
        >
          <div className="px-3 sm:px-4 h-12 flex items-center gap-3 lg:hidden text-white">
            <Link href="/" className="shrink-0">
              <Marca descritor={sessao.conta.nome} tamanho={28} />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <Notificacoes itens={notificacoes.itens} naoLidas={notificacoes.naoLidas} rota="/" />
              <form action={sair}>
                <button
                  type="submit"
                  className="text-[11px] font-semibold px-2 py-1 rounded-[9px] bg-white/10 border border-white/15 hover:bg-white/20"
                >
                  Sair
                </button>
              </form>
            </div>
          </div>

          <div
            className="hidden lg:flex items-center gap-3 h-[60px] px-5"
            style={{ background: 'var(--surface)' }}
          >
            <div className="ml-auto flex items-center gap-3">
              <Notificacoes itens={notificacoes.itens} naoLidas={notificacoes.naoLidas} rota="/" escuro={false} />
              <div className="text-right leading-tight">
                <div className="text-[12px] font-semibold">{sessao.usuario.nome}</div>
                <div className="text-[9.5px] uppercase tracking-[.12em]" style={{ color: 'var(--faint)' }}>
                  {ROTULO_PAPEL[sessao.papel]}
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

        {/* Depois do cabeçalho, e não junto do trilho: a faixa é `sticky` logo
            abaixo dele, e montada antes ficava coberta por ele. O colaborador
            navega pela tab bar do rodapé e não monta faixa nenhuma. */}
        {!ehColaborador && (
          <Suspense fallback={null}>
            <FaixaSecoes grupos={grupos} />
          </Suspense>
        )}

        <main
          className="px-3 sm:px-5 max-w-[1560px] py-4 lg:py-5 space-y-4"
          style={ehColaborador ? { paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' } : undefined}
        >
          {children}
        </main>
      </div>

      {ehColaborador && (
        <Suspense fallback={null}>
          <TabBar
            abas={[
              { href: '/hoje', label: 'Hoje' },
              { href: '/minha-escala', label: 'Escala' },
              { href: '/solicitacoes', label: 'Pedidos', novidade: pendentes > 0 },
              { href: '/mural', label: 'Mural', novidade: muralNovo > 0 },
            ]}
          />
        </Suspense>
      )}
    </div>
  );
}
