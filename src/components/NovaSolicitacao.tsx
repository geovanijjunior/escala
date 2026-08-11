'use client';

import { useState } from 'react';
import {
  GRUPO_DO_TIPO, GRUPOS_AUSENCIA, OPCOES_FERIAS, TIPOS_COM_PERIODO,
  type TipoSolicitacao,
} from '@/lib/domain/escalas/constantes';

/** Soma dias corridos a uma data ISO, sem passar por fuso. */
function somaDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1, d + dias));
  return base.toISOString().slice(0, 10);
}

const formatar = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Formulário de abertura de solicitação.
 *
 * Cada tipo pede uma coisa diferente, e os campos aparecem só no tipo que os
 * exige — campo irrelevante visível e vazio é convite a preencher errado.
 */
export function NovaSolicitacao({
  unidades, tipos,
}: {
  unidades: { id: number; nome: string }[];
  tipos: { chave: string; label: string; sla: number }[];
}) {
  const [tipo, setTipo] = useState(tipos[0]?.chave ?? '');
  const [opcao, setOpcao] = useState(OPCOES_FERIAS[0].chave);
  const [inicio, setInicio] = useState('');

  const escolhido = tipos.find(t => t.chave === tipo);
  const temPeriodo = TIPOS_COM_PERIODO.includes(tipo as TipoSolicitacao);
  const grupo = GRUPO_DO_TIPO[tipo as TipoSolicitacao];
  const motivos = GRUPOS_AUSENCIA.find(g => g.grupo === grupo)?.motivos ?? [];

  // Férias: a opção define quantos dias tem a primeira parcela, e o fim sai da
  // conta assim que a data de início é preenchida. Calcular de cabeça "20 dias
  // a partir de 03/11" é a fonte clássica do erro de um dia.
  const ferias = OPCOES_FERIAS.find(o => o.chave === opcao)!;
  const diasPrimeira = ferias.parcelas[0];
  const fimCalculado = tipo === 'FERIAS' && inicio ? somaDias(inicio, diasPrimeira - 1) : '';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="esc-rotulo">Tipo</span>
          <select name="tipo" value={tipo} onChange={e => setTipo(e.target.value)} required className="esc-input">
            {tipos.map(t => <option key={t.chave} value={t.chave}>{t.label}</option>)}
          </select>
        </label>

        {tipo === 'FERIAS' && (
          <label className="block lg:col-span-2">
            <span className="esc-rotulo">Opção de férias</span>
            <select
              name="opcaoFerias"
              value={opcao}
              onChange={e => setOpcao(e.target.value)}
              required
              className="esc-input"
            >
              {OPCOES_FERIAS.map(o => <option key={o.chave} value={o.chave}>{o.label}</option>)}
            </select>
          </label>
        )}

        {grupo && (
          <label className="block">
            <span className="esc-rotulo">Motivo</span>
            <select name="motivo" required className="esc-input">
              {motivos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}

        <label className="block">
          <span className="esc-rotulo">{temPeriodo ? 'Início' : 'Data de referência'}</span>
          <input
            type="date"
            name="data"
            required
            className="esc-input"
            value={inicio}
            onChange={e => setInicio(e.target.value)}
          />
        </label>

        {temPeriodo && (
          <label className="block">
            <span className="esc-rotulo">Fim</span>
            {/* Em férias o fim é calculado e fica travado: quem decide o
                tamanho é a opção escolhida, não a digitação. */}
            <input
              type="date"
              name="dataFim"
              required={tipo !== 'FOLGA'}
              readOnly={tipo === 'FERIAS'}
              value={tipo === 'FERIAS' ? fimCalculado : undefined}
              className="esc-input"
              style={tipo === 'FERIAS' ? { background: 'var(--bg)' } : undefined}
            />
            <span className="esc-ajuda mt-1 block">
              {tipo === 'FERIAS'
                ? (inicio
                    ? `${diasPrimeira} dias corridos: ${formatar(inicio)} a ${formatar(fimCalculado)}.`
                    : 'Preencha o início e o fim é calculado.')
                : tipo === 'FOLGA'
                  ? 'Vazio = só o dia de início.'
                  : 'O período inteiro entra na escala quando a licença for aprovada.'}
            </span>
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

      {tipo === 'FERIAS' && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: 'var(--line-2)' }}>
          {ferias.abono > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Esta opção inclui <strong>{ferias.abono} dias de abono</strong> — vendidos, não descansados,
              e por isso fora da escala.
            </p>
          )}
          {ferias.parcelas.length > 1 && (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Férias parceladas: este pedido cobre a <strong>1ª parcela, de {diasPrimeira} dias</strong>.
              Abra um pedido para cada parcela seguinte
              ({ferias.parcelas.slice(1).join(' e ')} dias) — cada uma tem a sua data e precisa caber na
              escala do mês dela.
            </p>
          )}
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" name="lancadoFiori" value="1" />
            Já lancei estas férias no Fiori
          </label>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Marque só se o lançamento no Fiori já foi feito. O Planejamento usa isso para saber
            o que ainda falta lançar no sistema da folha.
          </p>
        </div>
      )}

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
            {tipo === 'TROCA_HORARIO'
              && ' O Planejamento encontra com quem a troca é possível e registra o par ao aplicar.'}
          </span>
        )}
      </div>
    </div>
  );
}
