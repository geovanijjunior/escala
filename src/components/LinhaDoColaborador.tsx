'use client';

import { useState } from 'react';
import { registrarOcorrencia } from '@/app/actions-solicitacoes';
import { TIPOS_OCORRENCIA, type TipoOcorrencia } from '@/lib/domain/escalas/constantes';

const TIPOS = Object.entries(TIPOS_OCORRENCIA) as [TipoOcorrencia, typeof TIPOS_OCORRENCIA[TipoOcorrencia]][];

/**
 * Lançamento de ocorrência na linha do colaborador.
 *
 * Ficava num formulário único no rodapé do dia, com um seletor de pessoa: quem
 * lançava tinha de achar de novo, na lista, o nome que já estava vendo. Aqui o
 * botão está ao lado da pessoa, e o formulário abre com ela já escolhida.
 *
 * Os campos mudam com o tipo, porque cada tipo mede uma coisa: atraso conta
 * minutos, falta conta dias, saída antecipada quer a hora — e o cálculo dos
 * minutos é do servidor, contra a jornada. Antes só existia a caixa de minutos,
 * então tudo o mais ia para a observação, em texto livre, quando ia.
 */
export function LinhaDoColaborador({
  colaboradorId, colaboradorNome, data, competencia, volta, colegas, colunas, acoes, children,
}: {
  colaboradorId: number;
  colaboradorNome: string;
  data: string;
  competencia: string;
  volta: string;
  colegas: { id: number; nome: string }[];
  /** Quantas colunas a tabela tem — a linha do formulário ocupa todas. */
  colunas: number;
  /** Ações que já existiam na célula da direita (travar/liberar). */
  acoes?: React.ReactNode;
  /** As células da linha, montadas no servidor. */
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoOcorrencia>('ATRASO');
  const pede = TIPOS_OCORRENCIA[tipo].pede;

  return (
    <>
      <tr>
        {children}
        <td className="text-right whitespace-nowrap">
          {acoes}
          <button
            type="button"
            onClick={() => setAberto(a => !a)}
            className="esc-btn esc-btn-outline esc-btn-sm ml-1.5"
            aria-expanded={aberto}
          >
            Lançar ocorrência
          </button>
        </td>
      </tr>

      {/* Linha própria, ocupando a largura da tabela. Dentro da célula de ações
          o formulário estourava a coluna e empurrava a tabela para o scroll
          horizontal — o campo de horário ficava fora da tela. */}
      {aberto && (
      <tr>
        <td colSpan={colunas} style={{ background: 'var(--bg)' }}>
    <form action={registrarOcorrencia} className="flex flex-wrap items-end gap-2 py-1">
      <input type="hidden" name="colaboradorId" value={colaboradorId} />
      <input type="hidden" name="data" value={data} />
      <input type="hidden" name="competencia" value={competencia} />
      <input type="hidden" name="volta" value={volta} />

      <label className="block">
        <span className="esc-rotulo">Tipo — {colaboradorNome}</span>
        <select
          name="tipo"
          value={tipo}
          onChange={e => setTipo(e.target.value as TipoOcorrencia)}
          className="esc-input w-52 py-1"
        >
          {TIPOS.map(([chave, cfg]) => <option key={chave} value={chave}>{cfg.label}</option>)}
        </select>
      </label>

      {pede === 'minutos' && (
        <label className="block">
          <span className="esc-rotulo">Minutos</span>
          <input type="number" name="minutos" min={1} defaultValue={15} required className="esc-input w-24 py-1 esc-num" />
        </label>
      )}

      {pede === 'dias' && (
        <>
          <label className="block">
            <span className="esc-rotulo">Dias de falta</span>
            <input type="number" name="dias" min={1} max={365} defaultValue={1} required className="esc-input w-24 py-1 esc-num" />
          </label>
          <label className="block">
            <span className="esc-rotulo">Início</span>
            <input type="date" name="inicio" defaultValue={data} required className="esc-input w-40 py-1" />
          </label>
        </>
      )}

      {pede === 'saida' && (
        <label className="block">
          <span className="esc-rotulo">Saiu às</span>
          <input type="time" name="horaSaida" required className="esc-input w-28 py-1" />
          <span className="esc-ajuda mt-1 block">Os minutos saem do cálculo contra a jornada.</span>
        </label>
      )}

      {pede === 'parceiro' && (
        <label className="block">
          <span className="esc-rotulo">Trocou com</span>
          <select name="parceiroId" required className="esc-input w-52 py-1">
            <option value="">Selecione</option>
            {colegas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      )}

      <label className="block flex-1 min-w-[180px]">
        <span className="esc-rotulo">Observação</span>
        <input
          name="obs"
          required={pede === 'nada'}
          className="esc-input py-1"
          placeholder={pede === 'nada' ? 'Obrigatório neste tipo' : 'Contexto do lançamento'}
        />
      </label>

      <button type="submit" className="esc-btn esc-btn-sm">Registrar</button>
      <button type="button" onClick={() => setAberto(false)} className="esc-btn esc-btn-ghost esc-btn-sm">
        Cancelar
      </button>
    </form>
        </td>
      </tr>
      )}
    </>
  );
}
