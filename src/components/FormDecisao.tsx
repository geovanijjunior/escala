'use client';

import { useState } from 'react';
import { decidirSolicitacao } from '@/app/actions-solicitacoes';

export interface Decisao {
  acao: string;
  rotulo: string;
  tom?: 'primario' | 'sucesso' | 'outline';
}

const CLASSE = {
  primario: 'esc-btn esc-btn-sm',
  sucesso: 'esc-btn esc-btn-sucesso esc-btn-sm',
  outline: 'esc-btn esc-btn-outline esc-btn-sm',
};

/**
 * As decisões de um cartão, com UMA observação para todas elas.
 *
 * A primeira versão dava a cada botão o seu formulário e o seu "+ observação".
 * Cinco campos idênticos empilhados na mesma linha, e — pior — o que se
 * digitava num deles não ia junto ao clicar noutro: a observação escrita ao
 * lado de "Aprovar" sumia se a pessoa mudasse de ideia e clicasse em "Tratativa
 * futura". O teste caiu nisso antes de qualquer usuário, o que é a única boa
 * hora de cair.
 *
 * A observação não pertence a um botão: pertence à decisão que está sendo
 * tomada, qualquer que seja. Então é um formulário só, com um campo só, e os
 * botões distinguem-se pelo `name`/`value` do próprio submit — que é como o
 * HTML resolve isso desde sempre, sem estado nenhum do lado do cliente.
 *
 * Recusas ficam de fora deste componente: elas EXIGEM justificativa, e um campo
 * opcional compartilhado não sabe cobrar. Ver `FormRecusa` ao lado.
 */
export function FormDecisao({
  id, volta, decisoes, dica,
}: {
  id: number;
  volta: string;
  decisoes: Decisao[];
  /** Texto curto abaixo dos botões: o que cada decisão implica. */
  dica?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <form action={decidirSolicitacao} className="flex flex-wrap items-end gap-2 w-full">
      <input type="hidden" name="id" value={id} />
      {/* Decidir de dentro de uma aba precisa devolver àquela aba. */}
      <input type="hidden" name="_volta" value={volta} />

      {aberto && (
        <label className="block w-full">
          <span className="esc-rotulo">Observação (opcional)</span>
          <input
            name="motivo"
            placeholder="Fica no histórico do pedido, junto com a decisão"
            className="esc-input"
            autoFocus
          />
        </label>
      )}

      {decisoes.map(d => (
        <button
          key={d.acao}
          type="submit"
          name="acao"
          value={d.acao}
          className={CLASSE[d.tom ?? 'outline']}
        >
          {d.rotulo}
        </button>
      ))}

      {/* Fechado por padrão: aprovar não pode custar um clique a mais a quem
          não tem o que comentar, que é a maioria das vezes. */}
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="esc-btn esc-btn-ghost esc-btn-sm"
        title="Registra uma observação no histórico do pedido"
      >
        {aberto ? 'sem observação' : '+ observação'}
      </button>

      {dica && (
        <span className="text-[11px] w-full" style={{ color: 'var(--muted)' }}>{dica}</span>
      )}
    </form>
  );
}

/**
 * Recusa em duas etapas. A justificativa é obrigatória e o botão só libera com
 * texto — quem recebe a recusa precisa saber por quê, e depois é tarde para
 * pedir o motivo.
 */
export function FormRecusa({
  id, acao, rotulo, volta,
}: { id: number; acao: string; rotulo: string; volta: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="esc-btn esc-btn-outline esc-btn-sm">
        {rotulo}
      </button>
    );
  }

  return (
    <form action={decidirSolicitacao} className="flex flex-wrap items-end gap-2 w-full">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="_volta" value={volta} />
      <label className="block flex-1 min-w-[220px]">
        <span className="esc-rotulo">Justificativa da recusa</span>
        <input
          name="motivo"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Explique o motivo para quem abriu o pedido"
          className="esc-input"
          required
          minLength={5}
          autoFocus
        />
      </label>
      <button type="submit" className="esc-btn esc-btn-danger esc-btn-sm" disabled={motivo.trim().length < 5}>
        Confirmar recusa
      </button>
      <button type="button" onClick={() => setAberto(false)} className="esc-btn esc-btn-ghost esc-btn-sm">
        Cancelar
      </button>
    </form>
  );
}
