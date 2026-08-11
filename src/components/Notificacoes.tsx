import { formatarData } from '@/lib/domain/escalas/datas';
import { TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { abrirNotificacao, marcarNotificacoesLidas } from '@/app/actions-notificacoes';
import type { Notificacao } from '@/lib/data/escalas';
import type { TipoSolicitacao } from '@/lib/domain/escalas/constantes';

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
  itens, naoLidas, rota,
}: { itens: Notificacao[]; naoLidas: number; rota: string }) {
  return (
    <details className="relative">
      <summary
        className="list-none cursor-pointer grid place-items-center w-9 h-9 rounded-md hover:bg-white/10 relative"
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

      <div
        className="absolute right-0 mt-2 w-[min(360px,calc(100vw-24px))] rounded-lg border shadow-lg overflow-hidden z-50"
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
            Nada de novo por aqui.
          </p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto divide-y" style={{ borderColor: 'var(--line)' }}>
            {itens.map(n => {
              const tipo = TIPOS_SOLICITACAO[n.tipo as TipoSolicitacao];
              return (
                <li key={n.id}>
                  {/* Form, e não link: abrir o aviso precisa marcar o sino como
                      lido no mesmo passo, senão o contador nunca baixa. */}
                  <form action={abrirNotificacao}>
                  <button
                    type="submit"
                    className="block w-full text-left px-3 py-2.5 hover:bg-[var(--surface-2)]"
                    style={n.naoLida ? { background: 'var(--brand-50)' } : undefined}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold">{n.etapa}</span>
                      <span className="text-[10.5px] ml-auto shrink-0 esc-num" style={{ color: 'var(--muted)' }}>
                        {formatarData(n.em.slice(0, 10))}
                      </span>
                    </div>
                    <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                      {tipo?.label ?? 'Solicitação'}
                      {n.data && ` de ${formatarData(n.data)}`}
                      {n.colaboradorNome && ` · ${n.colaboradorNome}`}
                      {n.porNome && ` · por ${n.porNome}`}
                    </p>
                    {n.detalhe && (
                      <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--muted)' }}>{n.detalhe}</p>
                    )}
                  </button>
                  </form>
                </li>
              );
            })}
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
