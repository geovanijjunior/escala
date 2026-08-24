import { formatarData } from '@/lib/domain/escalas/datas';
import { ALCANCES } from '@/lib/avisos';
import { descartarAlteracoesPendentes, publicarAlteracoes } from '@/app/actions-geracao';
import type { AlteracaoPendente } from '@/lib/data/escalas';

/**
 * Caixa de saída: o que já mudou na escala e a equipe ainda não sabe.
 *
 * Fica no topo da tela, acima da escala, porque é um estado do qual se precisa
 * sair — a escala no banco já mudou, mas quem trabalha nela continua vendo a
 * versão antiga. Enquanto esta barra estiver aqui, as duas estão diferentes.
 */
export function AlteracoesPendentes({
  itens, competencia, conflitos, alertas, volta,
}: {
  itens: AlteracaoPendente[];
  competencia: string;
  conflitos: number;
  alertas: number;
  /** Para onde as duas ações voltam — a tela que está hospedando a barra. */
  volta: string;
}) {
  return (
    <div id="alteracoes-pendentes" className="rounded-lg border" style={{ borderColor: 'var(--amber)', background: 'var(--amber-bg)' }}>
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--amber)' }}>
            {itens.length} alteração(ões) que a equipe ainda não recebeu
          </p>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--amber)' }}>
            A escala já está alterada aqui. Continue mexendo à vontade e comunique quando o
            mês estiver de pé.
            {(conflitos > 0 || alertas > 0) && (
              <> No estado atual há <strong>{conflitos} conflito(s)</strong> e {alertas} alerta(s) —
              informação, não impedimento.</>
            )}
          </p>
        </div>

        <form action={publicarAlteracoes} className="flex flex-wrap items-center gap-2 ml-auto">
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="volta" value={volta} />
          <select name="alcance" defaultValue="afetados" className="esc-input py-1 w-[188px]" aria-label="Quem avisar">
            {ALCANCES.map(a => <option key={a.chave} value={a.chave}>Avisar: {a.label}</option>)}
          </select>
          <button type="submit" className="esc-btn esc-btn-sm">Publicar alterações</button>
        </form>

        <form action={descartarAlteracoesPendentes}>
          <input type="hidden" name="competencia" value={competencia} />
          <input type="hidden" name="volta" value={volta} />
          <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">Não avisar</button>
        </form>
      </div>

      <ul
        className="px-4 pb-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-[11.5px]"
        style={{ color: 'var(--amber)' }}
      >
        {itens.map(i => (
          <li key={i.id} className="truncate">
            <span className="esc-num">{formatarData(i.data)}</span>{' · '}
            <span className="font-medium">{i.colaboradorNome}</span>
            {i.de ? `: ${i.de} → ${i.para}` : `: ${i.para}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

