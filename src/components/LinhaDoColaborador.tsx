'use client';

import { useState } from 'react';
import { registrarOcorrencia } from '@/app/actions-solicitacoes';
import { TIPOS_OCORRENCIA, type TipoOcorrencia } from '@/lib/domain/escalas/constantes';

const TIPOS = Object.entries(TIPOS_OCORRENCIA) as [TipoOcorrencia, typeof TIPOS_OCORRENCIA[TipoOcorrencia]][];

/**
 * Linha do colaborador no detalhe do dia, com uma gaveta de ações.
 *
 * A linha já teve tudo aberto ao mesmo tempo: seletor de alocação, botão de
 * mover, seletor de quem avisar, travar e lançar ocorrência, todos lado a lado
 * em treze linhas seguidas. Cada controle era pequeno e legítimo; juntos viravam
 * uma parede, e a informação que a tela existe para dar — quem está onde hoje —
 * ficava atrás dos controles para mudá-la.
 *
 * Agora a linha mostra o estado e um botão. As ações vivem numa gaveta abaixo
 * dela, separadas por assunto: onde a pessoa fica, se aquilo está travado, e o
 * que aconteceu no dia.
 */
export function LinhaDoColaborador({
  colaboradorId, colaboradorNome, data, competencia, volta, colegas, colunas,
  mover, trava, podeLancarOcorrencia, children,
}: {
  colaboradorId: number;
  colaboradorNome: string;
  data: string;
  competencia: string;
  volta: string;
  colegas: { id: number; nome: string }[];
  /** Quantas colunas a tabela tem — a gaveta ocupa todas. */
  colunas: number;
  /** Formulário de reposicionamento, montado no servidor. Ausente sem permissão. */
  mover?: React.ReactNode;
  /** Formulário de travar/liberar, montado no servidor. */
  trava?: React.ReactNode;
  podeLancarOcorrencia: boolean;
  /** As células da linha, montadas no servidor. */
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoOcorrencia>('ATRASO');
  const pede = TIPOS_OCORRENCIA[tipo].pede;

  const temAcao = !!mover || !!trava || podeLancarOcorrencia;

  return (
    <>
      <tr>
        {children}
        {temAcao && (
          <td className="text-right whitespace-nowrap">
            <button
              type="button"
              onClick={() => setAberto(a => !a)}
              className={`esc-btn esc-btn-sm ${aberto ? '' : 'esc-btn-outline'}`}
              aria-expanded={aberto}
            >
              {aberto ? 'Fechar' : 'Ajustar'}
            </button>
          </td>
        )}
      </tr>

      {/* Linha própria, ocupando a largura da tabela. Dentro da célula de ações
          o formulário estourava a coluna e empurrava a tabela para o scroll
          horizontal — o campo de horário ficava fora da tela. */}
      {aberto && temAcao && (
        <tr>
          <td colSpan={colunas} style={{ background: 'var(--bg)' }}>
            <div className="py-2.5 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--faint)' }}>
                {colaboradorNome}
              </p>

              {(mover || trava) && (
                <section className="flex flex-wrap items-end gap-2">
                  {mover}
                  {trava}
                </section>
              )}

              {podeLancarOcorrencia && (
                <section className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
                  <form action={registrarOcorrencia} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="colaboradorId" value={colaboradorId} />
                    <input type="hidden" name="data" value={data} />
                    <input type="hidden" name="competencia" value={competencia} />
                    <input type="hidden" name="volta" value={volta} />

                    <label className="block">
                      <span className="esc-rotulo">Lançar ocorrência</span>
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
                  </form>
                </section>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
