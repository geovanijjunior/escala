'use client';

import { useState } from 'react';

/**
 * Formulário de abertura de solicitação. Os campos condicionais (parceiro de
 * troca, unidade desejada) aparecem só no tipo que os exige, em vez de deixar
 * campos irrelevantes visíveis e vazios.
 */
export function NovaSolicitacao({
  colegas, unidades, tipos,
}: {
  colegas: { id: number; nome: string }[];
  unidades: { id: number; nome: string }[];
  tipos: { chave: string; label: string; sla: number }[];
}) {
  const [tipo, setTipo] = useState(tipos[0]?.chave ?? '');
  const escolhido = tipos.find(t => t.chave === tipo);

  // Férias e folga cobrem um período; os demais tipos são de um dia só.
  const temPeriodo = tipo === 'FERIAS' || tipo === 'FOLGA';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="esc-rotulo">Tipo</span>
          <select name="tipo" value={tipo} onChange={e => setTipo(e.target.value)} className="esc-input">
            {tipos.map(t => <option key={t.chave} value={t.chave}>{t.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="esc-rotulo">{temPeriodo ? 'Início' : 'Data de referência'}</span>
          <input type="date" name="data" required className="esc-input" />
        </label>

        {temPeriodo && (
          <label className="block">
            <span className="esc-rotulo">Fim</span>
            <input type="date" name="dataFim" className="esc-input" />
            <span className="esc-ajuda mt-1 block">
              {tipo === 'FERIAS'
                ? 'O período inteiro entra na escala quando as férias forem aprovadas.'
                : 'Vazio = só o dia de início.'}
            </span>
          </label>
        )}

        {tipo === 'TROCA_HORARIO' && (
          <label className="block">
            <span className="esc-rotulo">Trocar com</span>
            <select name="parceiroId" required className="esc-input">
              <option value="">Selecione o colega</option>
              {colegas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        )}

        {tipo === 'TROCA_UNIDADE' && (
          <label className="block">
            <span className="esc-rotulo">Unidade desejada</span>
            <select name="unidadeDesejadaId" required className="esc-input">
              <option value="">Selecione a unidade</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
        )}
      </div>

      <label className="block">
        <span className="esc-rotulo">Justificativa</span>
        <textarea
          name="detalhe"
          required
          minLength={5}
          rows={3}
          className="esc-input"
          placeholder="Explique o motivo do pedido — é o que o gestor lê para decidir."
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="esc-btn">Enviar solicitação</button>
        {escolhido && (
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Prazo de resposta previsto: {escolhido.sla}h.
            {tipo === 'TROCA_HORARIO' && ' A troca só vale após o aceite do colega, a triagem e a aprovação do gestor.'}
            {colegas.length === 0 && tipo === 'TROCA_HORARIO' && ' Não há colegas do mesmo regime e equipe disponíveis.'}
          </span>
        )}
      </div>
    </div>
  );
}
