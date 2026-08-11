'use client';

import { useState } from 'react';
import { MOTIVOS_INATIVACAO } from '@/lib/domain/escalas/constantes';

/**
 * Situação do colaborador: ativo, ou inativo com motivo.
 *
 * A tela pedia "ativo / afastado / desligado" e mostrava a data de desligamento
 * sempre — inclusive para quem estava ativo, onde ela não quer dizer nada. Aqui
 * a pergunta é a que a pessoa faz na cabeça: continua na equipe? Se não, por
 * quê? E só o desligamento, que é o único motivo que encerra o vínculo, pede a
 * data.
 *
 * O `status` gravado continua sendo ativo/afastado/desligado — quem decide é o
 * servidor, a partir do motivo. A tela não manda status: mandar os dois seria
 * deixar dois campos dizerem a mesma coisa, e um dia eles discordariam.
 */
export function SituacaoColaborador({
  statusInicial, motivoInicial, desligamentoInicial,
}: {
  statusInicial: 'ativo' | 'afastado' | 'desligado';
  motivoInicial: string;
  desligamentoInicial: string;
}) {
  const [ativo, setAtivo] = useState(statusInicial === 'ativo');
  const [motivo, setMotivo] = useState(
    motivoInicial || (statusInicial === 'desligado' ? 'DESLIGAMENTO' : MOTIVOS_INATIVACAO[1].chave)
  );

  const encerra = MOTIVOS_INATIVACAO.find(m => m.chave === motivo)?.desliga ?? false;

  return (
    <>
      <label className="block">
        <span className="esc-rotulo">Situação</span>
        <select
          name="ativo"
          value={ativo ? '1' : '0'}
          onChange={e => setAtivo(e.target.value === '1')}
          className="esc-input"
        >
          <option value="1">Ativo</option>
          <option value="0">Inativo</option>
        </select>
      </label>

      {!ativo && (
        <label className="block">
          <span className="esc-rotulo">Motivo da inativação</span>
          <select
            name="motivoStatus"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            required
            className="esc-input"
          >
            {MOTIVOS_INATIVACAO.map(m => <option key={m.chave} value={m.chave}>{m.label}</option>)}
          </select>
        </label>
      )}

      {!ativo && encerra && (
        <label className="block">
          <span className="esc-rotulo">Data de desligamento</span>
          <input
            type="date"
            name="desligamento"
            defaultValue={desligamentoInicial}
            required
            className="esc-input"
          />
        </label>
      )}

      {!ativo && (
        <p className="text-[11.5px] sm:col-span-2 lg:col-span-3" style={{ color: 'var(--muted)' }}>
          Colaborador inativo fica de fora da geração da escala, e o histórico dos meses
          anteriores continua intacto.
        </p>
      )}
    </>
  );
}
