import { formatarData } from '@/lib/domain/escalas/datas';
import { abrirNotificacao, marcarNotificacoesLidas } from '@/app/actions-notificacoes';
import type { Notificacao } from '@/lib/data/escalas';

/**
 * Sino de notificações no cabeçalho.
 *
 * Usa `<details>` em vez de estado no cliente: o painel abre e fecha sem
 * JavaScript, o que mantém isto como componente de servidor e evita mandar mais
 * um bundle para uma peça que aparece em toda página.
 *
 * O conteúdo é o mesmo para os três papéis porque a policy de RLS já recorta o
 * que cada um enxerga — o colaborador recebe a devolutiva dos próprios pedidos e
 * os convites de troca, o gestor o que chega da equipe, o planejamento o que
 * entra em triagem.
 */
export function Notificacoes({
  itens, naoLidas, rota, escuro = true,
}: { itens: Notificacao[]; naoLidas: number; rota: string; escuro?: boolean }) {
  return (
    <details className="relative">
      {/* O sino vive nos dois fundos: escuro no cabeçalho do celular, claro na
          topbar do desktop. Sem saber em qual está, ele fica invisível em um
          dos dois. */}
      <summary
        className={`list-none cursor-pointer grid place-items-center w-9 h-9 rounded-[11px] relative ${
          escuro ? 'hover:bg-white/10' : 'hover:bg-[color:var(--bg)]'
        }`}
        style={escuro ? undefined : { color: 'var(--muted)' }}
        aria-label={naoLidas > 0 ? `Notificações — ${naoLidas} não lida(s)` : 'Notificações'}
      >
        <Sino />
        {naoLidas > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold grid place-items-center esc-num"
            style={{ background: 'var(--rose)', color: '#fff' }}
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </summary>

      {/* No celular o painel se ancora na TELA, não no sino.
          Ancorado no sino, o `right-0` alinhava a borda direita do painel com a
          do sino — que não fica na beira da tela, tem o botão "Sair" à direita
          dele. Os 360px de painel cresciam para a esquerda a partir dali e
          saíam pela borda: o título aparecia como "ificações" e cada aviso
          começava cortado. Como o sino existe em dois lugares (cabeçalho do
          celular e topbar do desktop), a correção não pode ser reposicionar o
          sino — é o painel que passa a ser `fixed` entre as duas margens
          enquanto a tela é estreita. De `lg` para cima ele volta a pender do
          sino, onde há espaço de sobra. */}
      <div
        className="fixed left-2 right-2 top-[57px] w-auto lg:absolute lg:left-auto lg:right-0 lg:top-auto lg:mt-2 lg:w-[360px] rounded-lg border shadow-lg overflow-hidden z-50"
        style={{ background: 'var(--surface)', borderColor: 'var(--line-2)', color: 'var(--text)' }}
      >
        <div
          className="px-3 py-2.5 border-b flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="text-[12.5px] font-semibold">Notificações</span>
          {naoLidas > 0 && (
            <form action={marcarNotificacoesLidas}>
              <input type="hidden" name="rota" value={rota} />
              <button type="submit" className="text-[11.5px] font-semibold" style={{ color: 'var(--brand-700)' }}>
                Marcar como lidas
              </button>
            </form>
          )}
        </div>

        {itens.length === 0 ? (
          <p className="px-3 py-6 text-[12px] text-center" style={{ color: 'var(--muted)' }}>
            Tudo lido. O que você já abriu sai daqui.
          </p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto divide-y" style={{ borderColor: 'var(--line)' }}>
            {itens.map(n => (
              <li key={n.id}>
                {/* Form, e não link: abrir o aviso precisa marcá-lo como lido
                    no mesmo passo, senão ele continua na lista depois de
                    aberto e o contador nunca baixa. */}
                <form action={abrirNotificacao}>
                  <input type="hidden" name="rota" value={n.rota} />
                  <input type="hidden" name="chave" value={n.id} />
                  <button
                    type="submit"
                    className="block w-full text-left px-3 py-2.5 hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold">{n.etapa}</span>
                      <span className="text-[10.5px] ml-auto shrink-0 esc-num" style={{ color: 'var(--muted)' }}>
                        {formatarData(n.em.slice(0, 10))}
                      </span>
                    </div>
                    {n.detalhe && (
                      <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>{n.detalhe}</p>
                    )}
                    {n.porNome && (
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>por {n.porNome}</p>
                    )}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function Sino() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path
        d="M8 1.8a3.6 3.6 0 0 0-3.6 3.6c0 3-1.1 4-1.1 4h9.4s-1.1-1-1.1-4A3.6 3.6 0 0 0 8 1.8ZM6.6 11.8a1.5 1.5 0 0 0 2.8 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
