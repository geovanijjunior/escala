'use client';

import { useState } from 'react';
import { DIAS_ABREV } from '@/lib/domain/escalas/datas';
import type { HomeOffice, Unidade } from '@/lib/domain/escalas/tipos';

const UTEIS = [1, 2, 3, 4, 5];
const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** "terça", "terça e quarta", "terça, quarta e sexta". */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

interface Props {
  unidades: Unidade[];
  unidadesFixas: Record<number, number>;
  homeOffice: HomeOffice;
  elegHome: boolean;
  nome: string;
}

/**
 * Unidade fixa por dia da semana + home office, juntos porque se contradizem:
 * um dia não pode estar preso a uma unidade e ser home office ao mesmo tempo.
 * Mantê-los no mesmo componente permite mostrar o conflito na hora, em vez de
 * deixá-lo aparecer só na pré-checagem da geração.
 *
 * A grade é uma linha por dia da semana, não uma matriz dia × unidade: lê-se na
 * mesma ordem em que a regra é dita — "terça no Morumbi".
 */
export function UnidadesFixasEHomeOffice({ unidades, unidadesFixas, homeOffice, elegHome, nome }: Props) {
  const [fixas, setFixas] = useState<Record<number, number>>(unidadesFixas);
  const [modo, setModo] = useState<'' | 'FIXO' | 'COTA'>(homeOffice.modo ?? '');
  const [diasHo, setDiasHo] = useState<number[]>(homeOffice.diasSemana);

  const definir = (dow: number, unidadeId: number | null) => {
    setFixas(atual => {
      const proximo = { ...atual };
      if (unidadeId === null) delete proximo[dow];
      else proximo[dow] = unidadeId;
      return proximo;
    });
  };

  const alternarDiaHo = (dow: number) =>
    setDiasHo(a => (a.includes(dow) ? a.filter(x => x !== dow) : [...a, dow]));

  const conflitos = modo === 'FIXO' ? diasHo.filter(d => fixas[d] !== undefined) : [];
  const nFixos = Object.keys(fixas).length;
  const livres = 5 - nFixos;

  const porUnidade = new Map<number, number[]>();
  for (const [dow, un] of Object.entries(fixas)) {
    porUnidade.set(un, [...(porUnidade.get(un) ?? []), Number(dow)]);
  }

  return (
    <>
      <section>
        <span className="esc-rotulo">Unidade fixa por dia da semana</span>
        <p className="text-[11px] leading-relaxed mb-2.5" style={{ color: 'var(--muted)' }}>
          Trave um dia da semana numa unidade — por exemplo, toda terça e quarta no Morumbi. Esses dias saem da
          distribuição percentual: já estão decididos e ocupam posição na unidade.
        </p>

        <div className="flex flex-col gap-1.5">
          {UTEIS.map(dow => {
            const atual = fixas[dow];
            const conflita = conflitos.includes(dow);
            return (
              <div key={dow} className="flex flex-wrap items-center gap-2.5">
                <input type="hidden" name={`fixa_${dow}`} value={atual ?? ''} />
                <span className="text-[12.5px] font-semibold w-[74px] shrink-0">{DIAS_LONGOS[dow]}</span>
                <div
                  className="inline-flex rounded-md overflow-hidden border"
                  style={{ borderColor: 'var(--line-2)' }}
                  role="group"
                  aria-label={`Unidade fixa de ${DIAS_LONGOS[dow]}`}
                >
                  <BotaoSeg ativo={atual === undefined} onClick={() => definir(dow, null)} cor={null}>
                    Livre
                  </BotaoSeg>
                  {unidades.map(u => (
                    <BotaoSeg key={u.id} ativo={atual === u.id} onClick={() => definir(dow, u.id)} cor={u.cor}>
                      {u.nome}
                    </BotaoSeg>
                  ))}
                </div>
                {conflita && (
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--rose)' }}>
                    também marcado como home office fixo
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {nFixos === 0 ? (
          <p className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
            Nenhum dia fixo — os 5 dias úteis entram na distribuição percentual.
          </p>
        ) : (
          <div
            className="mt-2.5 px-3 py-2 rounded-md text-[12px] leading-relaxed border"
            style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-100)' }}
          >
            {[...porUnidade.entries()].map(([un, dias], i) => {
              const u = unidades.find(x => x.id === un);
              const nomes = dias.sort((a, b) => a - b).map(d => DIAS_LONGOS[d].toLowerCase());
              return (
                <span key={un}>
                  {i > 0 && ' · '}
                  <strong style={{ color: 'var(--brand-900)' }}>{listar(nomes)}</strong>
                  {dias.length > 1 ? ' fixas' : ' fixa'} no {u?.nome ?? '—'}
                </span>
              );
            })}
            {'. '}
            {livres === 0
              ? 'A semana inteira está fixada — a distribuição percentual deixa de ter efeito.'
              : livres === 1
              ? 'Resta 1 dia útil para a distribuição percentual.'
              : `Restam ${livres} dias úteis para a distribuição percentual.`}
          </div>
        )}
      </section>

      <section>
        <span className="esc-rotulo">Home office</span>
        {!elegHome ? (
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {nome} não está marcado como elegível a home office no cadastro. Ajuste em Colaboradores para liberar
            esta seção.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {([['', 'Sem home office'], ['FIXO', 'Dias fixos'], ['COTA', 'Cota semanal']] as const).map(([v, l]) => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-[12.5px]"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <input
                    type="radio"
                    name="ho_modo"
                    value={v}
                    checked={modo === v}
                    onChange={() => setModo(v)}
                  />
                  {l}
                </label>
              ))}
            </div>

            {/* Só o painel do modo escolhido: três blocos de dias da semana ao
                mesmo tempo não deixam claro quais estão valendo. */}
            {modo === 'FIXO' && (
              <div className="rounded-md border p-3" style={{ borderColor: 'var(--line)' }}>
                <span className="esc-rotulo">Dias em home office</span>
                <div className="flex flex-wrap gap-1.5">
                  {UTEIS.map(d => (
                    <label
                      key={d}
                      className="flex items-center gap-1 text-[12px] px-2 py-1 rounded border cursor-pointer"
                      style={{ borderColor: conflitos.includes(d) ? 'var(--rose)' : 'var(--line-2)' }}
                    >
                      <input
                        type="checkbox"
                        name="ho_dias_semana"
                        value={d}
                        checked={diasHo.includes(d)}
                        onChange={() => alternarDiaHo(d)}
                      />
                      {DIAS_ABREV[d]}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
                  Todo mês, nesses dias da semana. Um dia não pode ser home office fixo e unidade fixa ao mesmo tempo.
                </p>
              </div>
            )}

            {modo === 'COTA' && (
              <div className="rounded-md border p-3 space-y-2.5" style={{ borderColor: 'var(--line)' }}>
                <label className="block">
                  <span className="esc-rotulo">Dias por semana</span>
                  <input
                    type="number"
                    name="ho_quantidade"
                    min={1}
                    max={5}
                    required
                    defaultValue={homeOffice.quantidade || 2}
                    className="esc-input w-24 esc-num"
                  />
                </label>
                <div>
                  <span className="esc-rotulo">Dias de preferência</span>
                  <div className="flex flex-wrap gap-1.5">
                    {UTEIS.map(d => (
                      <label
                        key={d}
                        className="flex items-center gap-1 text-[12px] px-2 py-1 rounded border cursor-pointer"
                        style={{ borderColor: 'var(--line-2)' }}
                      >
                        <input
                          type="checkbox"
                          name="ho_dias_preferencia"
                          value={d}
                          defaultChecked={homeOffice.diasPreferencia.includes(d)}
                        />
                        {DIAS_ABREV[d]}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="esc-rotulo">Dias proibidos</span>
                  <div className="flex flex-wrap gap-1.5">
                    {UTEIS.map(d => (
                      <label
                        key={d}
                        className="flex items-center gap-1 text-[12px] px-2 py-1 rounded border cursor-pointer"
                        style={{ borderColor: 'var(--line-2)' }}
                      >
                        <input
                          type="checkbox"
                          name="ho_dias_proibidos"
                          value={d}
                          defaultChecked={homeOffice.diasProibidos.includes(d)}
                        />
                        {DIAS_ABREV[d]}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  A quantidade é rígida e o dia é flexível: o motor tenta os dias de preferência primeiro e nunca usa
                  os proibidos.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {conflitos.length > 0 && (
        <p
          className="text-[12px] font-medium px-3 py-2 rounded-md"
          style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}
          role="alert"
        >
          {listar(conflitos.sort((a, b) => a - b).map(d => DIAS_LONGOS[d].toLowerCase()))} está marcado como home
          office fixo e como unidade fixa ao mesmo tempo. Escolha um dos dois antes de salvar.
        </p>
      )}
    </>
  );
}

function BotaoSeg({
  ativo, onClick, cor, children,
}: { ativo: boolean; onClick: () => void; cor: string | null; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="text-[11.5px] font-semibold px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 transition-colors"
      style={{
        borderRightColor: 'var(--line-2)',
        background: ativo ? (cor ?? 'var(--muted)') : 'var(--surface)',
        color: ativo ? '#fff' : 'var(--muted)',
      }}
    >
      {children}
    </button>
  );
}
