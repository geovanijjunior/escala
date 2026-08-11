import Link from 'next/link';
import { DIAS_ABREV, dowDeIso, formatarData, somaHoras } from '@/lib/domain/escalas/datas';
import { MODALIDADES, TIPOS_OCORRENCIA } from '@/lib/domain/escalas/constantes';
import { alternarTrava, reposicionarAlocacao } from '@/app/actions-geracao';
import { LinhaDoColaborador } from './LinhaDoColaborador';
import { Badge, Bloco, aparencia } from './Ui';
import type { Alocacao, Colaborador, Equipe, Posto, Unidade } from '@/lib/domain/escalas/tipos';
import type { Ocorrencia } from '@/lib/data/escalas';

interface Props {
  data: string;
  competencia: string;
  alocacoes: Alocacao[];
  colaboradores: Colaborador[];
  equipes: Equipe[];
  unidades: Unidade[];
  postos: Posto[];
  ocorrencias: Ocorrencia[];
  feriado?: string;
  podeEditar: boolean;
  podeLancarOcorrencia: boolean;
  fecharHref: string;
  volta: string;
}

/** Fim do turno: jornada + 1h de intervalo quando a jornada passa de 6h. */
function faixaHoraria(c: Colaborador, dow: number): string {
  const horas = c.sextaReduzida && dow === 5 ? c.jornada - 1 : c.jornada;
  return `${c.entrada}–${somaHoras(c.entrada, horas + (horas > 6 ? 1 : 0))}`;
}

/**
 * Painel do dia. É uma rota com `?dia=`, não um overlay: o botão voltar do
 * navegador funciona e o link do dia pode ser compartilhado com o gestor.
 */
export function DetalheDoDia({
  data, competencia, alocacoes, colaboradores, equipes, unidades, postos, ocorrencias,
  feriado, podeEditar, podeLancarOcorrencia, fecharHref, volta,
}: Props) {
  const dow = dowDeIso(data);
  const colabPorId = new Map(colaboradores.map(c => [c.id, c]));
  const postoPorId = new Map(postos.map(p => [p.id, p]));
  const equipePorId = new Map(equipes.map(e => [e.id, e]));
  const ativas = unidades.filter(u => u.ativa);

  const trabalhando = alocacoes
    .filter(a => a.modalidade !== 'DESCANSO')
    .map(a => ({ a, c: colabPorId.get(a.colaboradorId) }))
    .filter((x): x is { a: Alocacao; c: Colaborador } => !!x.c)
    .sort((x, y) => x.c.nome.localeCompare(y.c.nome));

  const ocorrenciasPorColab = new Map<number, Ocorrencia[]>();
  for (const o of ocorrencias) ocorrenciasPorColab.set(o.colaboradorId, [...(ocorrenciasPorColab.get(o.colaboradorId) ?? []), o]);

  const contar = (fn: (a: Alocacao) => boolean) => alocacoes.filter(fn).length;

  return (
    <Bloco
      titulo={`${DIAS_ABREV[dow]}, ${formatarData(data)}${feriado ? ` · ${feriado}` : ''}`}
      desc={`${trabalhando.length} pessoa(s) em atividade neste dia.`}
      acoes={<Link href={fecharHref} className="esc-btn esc-btn-ghost esc-btn-sm">Fechar</Link>}
    >
      <div className="px-4 py-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 border-b" style={{ borderColor: 'var(--line)' }}>
        {ativas.map(u => {
          const n = contar(a => a.modalidade === 'UNIDADE' && a.unidadeId === u.id);
          return (
            <div key={u.id} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              <div className="esc-rotulo mb-1" style={{ color: u.cor }}>{u.nome}</div>
              <div className="text-[20px] font-semibold esc-num leading-none">{n}</div>
            </div>
          );
        })}
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
          <div className="esc-rotulo mb-1" style={{ color: '#6D28D9' }}>Home Office</div>
          <div className="text-[20px] font-semibold esc-num leading-none">{contar(a => a.modalidade === 'HOME')}</div>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
          <div className="esc-rotulo mb-1">Ausentes</div>
          <div className="text-[20px] font-semibold esc-num leading-none">
            {contar(a => ['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="esc-tabela">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Equipe · Cargo</th>
              <th>Alocação</th>
              <th>Horário</th>
              {(podeEditar || podeLancarOcorrencia) && <th className="text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {trabalhando.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8" style={{ color: 'var(--muted)' }}>
                  Ninguém está escalado neste dia.
                </td>
              </tr>
            )}
            {trabalhando.map(({ a, c }) => {
              const ap = aparencia(a.modalidade, a.unidadeId, unidades);
              const ocs = ocorrenciasPorColab.get(c.id) ?? [];
              return (
                <LinhaDoColaborador
                  key={c.id}
                  colaboradorId={c.id}
                  colaboradorNome={c.nome}
                  data={data}
                  competencia={competencia}
                  volta={volta}
                  colunas={podeEditar || podeLancarOcorrencia ? 5 : 4}
                  colegas={trabalhando.filter(x => x.c.id !== c.id).map(x => ({ id: x.c.id, nome: x.c.nome }))}
                  podeLancarOcorrencia={podeLancarOcorrencia}
                  mover={podeEditar ? (
                    <form action={reposicionarAlocacao} className="flex items-end gap-2">
                      <input type="hidden" name="colaboradorId" value={c.id} />
                      <input type="hidden" name="data" value={data} />
                      <input type="hidden" name="competencia" value={competencia} />
                      <input type="hidden" name="volta" value={volta} />
                      <label className="block">
                        <span className="esc-rotulo">Alocação</span>
                        <select
                          name="destino"
                          defaultValue={a.modalidade === 'UNIDADE' ? `UNIDADE:${a.unidadeId}` : a.modalidade}
                          className="esc-input w-48 py-1"
                          aria-label={`Alocação de ${c.nome}`}
                        >
                          {ativas.map(u => <option key={u.id} value={`UNIDADE:${u.id}`}>{u.nome}</option>)}
                          {(['HOME', 'EXTERNO', 'EVENTO', 'TREINA', 'FOLGA', 'AFAST'] as const).map(m => (
                            <option key={m} value={m}>{MODALIDADES[m].label}</option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Mover</button>
                    </form>
                  ) : undefined}
                  trava={podeEditar ? (
                    <form action={alternarTrava} className="flex items-end">
                      <input type="hidden" name="colaboradorId" value={c.id} />
                      <input type="hidden" name="data" value={data} />
                      <input type="hidden" name="competencia" value={competencia} />
                      <input type="hidden" name="volta" value={volta} />
                      <input type="hidden" name="modalidade" value={a.modalidade} />
                      <input type="hidden" name="unidadeId" value={a.unidadeId ?? ''} />
                      <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">
                        {a.travado ? 'Liberar a trava' : 'Travar neste dia'}
                      </button>
                    </form>
                  ) : undefined}
                >
                  <td>
                    <div className="font-medium flex items-center gap-1.5 flex-wrap">
                      {c.nome}
                      {a.travado && <Badge cor="var(--brand-700)" bg="var(--brand-100)">travado</Badge>}
                      {ocs.map(o => (
                        <Badge key={o.id} cor={TIPOS_OCORRENCIA[o.tipo].cor} bg="var(--bg)">
                          {TIPOS_OCORRENCIA[o.tipo].label}
                          {o.minutos > 0 ? ` ${o.minutos}min` : ''}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>{c.matricula}</div>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>
                    {equipePorId.get(c.equipeId)?.nome ?? '—'}
                    <div className="text-[10.5px]">{c.cargo}</div>
                  </td>
                  <td>
                    {/* Estado, não controle: a coluna diz onde a pessoa está, e
                        mudar isso é assunto da gaveta de ajuste. */}
                    <Badge cor={ap.cor} bg={ap.bg}>{ap.label}</Badge>
                    {/* O posto é a informação que diz ONDE dentro da unidade a
                        pessoa está. Sem ela, quem foi destacado para o Corpo
                        Clínico aparece como "Morumbi" igual a todo mundo, e o
                        destaque some da escala depois de gerado. */}
                    {a.postoId && postoPorId.has(a.postoId) && (
                      <div className="mt-1">
                        <Badge cor="var(--brand-700)" bg="var(--brand-100)">
                          {postoPorId.get(a.postoId)!.nome}
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className="esc-num" style={{ color: 'var(--muted)' }}>
                    {['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade) ? '—' : faixaHoraria(c, dow)}
                  </td>
                </LinhaDoColaborador>
              );
            })}
          </tbody>
        </table>
      </div>

    </Bloco>
  );
}
