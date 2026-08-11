'use client';

import { useState } from 'react';
import { decidirSolicitacao } from '@/app/actions-solicitacoes';

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
      {/* Recusar de dentro de uma aba precisa devolver àquela aba. */}
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
