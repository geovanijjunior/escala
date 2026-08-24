import Link from 'next/link';
import { DIAS_ABREV, dowDeIso, fimDoTurno, formatarData } from '@/lib/domain/escalas/datas';
import { MODALIDADES, TIPOS_OCORRENCIA } from '@/lib/domain/escalas/constantes';
import { alternarTrava, reposicionarAlocacao } from '@/app/actions-geracao';
import { LinhaDoColaborador } from './LinhaDoColaborador';
import { Badge, Bloco, aparencia } from './Ui';
import { capacidadeOperacional } from '@/lib/domain/escalas/conferencia';
import type {
  Alocacao, Aviso, CapacidadeOverride, Colaborador, Equipe, Posto, Unidade,
} from '@/lib/domain/escalas/tipos';
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
  /** Capacidade da área, para o painel dizer quantos lugares a unidade tem. */
  capacidades: CapacidadeOverride[];
  /**
   * O que a conferência apontou NESTE dia — conflitos (erro) e alertas (aviso).
   *
   * Vem calculado de fora, sobre o que está no banco agora. Sem isto, quem
   * remaneja uma escala publicada só descobria que estourou a unidade depois
   * de fechar o painel e reparar no número do cabeçalho do mês — quando o
   * aviso para a equipe já tinha saído.
   */
  conflitos: Aviso[];
  alertas: Aviso[];
  feriado?: string;
  podeEditar: boolean;
  podeLancarOcorrencia: boolean;
  fecharHref: string;
  volta: string;
}

function faixaHoraria(c: Colaborador, dow: number): string {
  return `${c.entrada}–${fimDoTurno(c.saida, c.sextaReduzida, dow)}`;
}

/**
 * Painel do dia. É uma rota com `?dia=`, não um overlay: o botão voltar do
 * navegador funciona e o link do dia pode ser compartilhado com o gestor.
 */
export function DetalheDoDia({
  data, competencia, alocacoes, colaboradores, equipes, unidades, postos, ocorrencias,
  capacidades, conflitos, alertas, feriado, podeEditar, podeLancarOcorrencia, fecharHref, volta,
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

  /**
   * Quem NÃO está neste dia, e por isso pode ser trazido para ele.
   *
   * Duas origens: quem está de descanso (o motor grava a linha) e quem não tem
   * linha nenhuma — admitido depois da geração, por exemplo. Ausência de
   * verdade fica de fora: férias e afastamento não são vaga a preencher, são
   * decisão registrada, e trazer alguém de férias pelo seletor do dia seria
   * desfazer uma aprovação sem passar por ela.
   */
  const foraDoDia = colaboradores
    .filter(c => c.status === 'ativo')
    .filter(c => {
      const a = alocacoes.find(x => x.colaboradorId === c.id);
      return !a || a.modalidade === 'DESCANSO';
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // A lotação de cada unidade neste dia. `capacidadeOperacional` é a mesma
  // função que a conferência usa para decidir se estourou — a tela não recalcula
  // a regra por conta própria.
  const lotacao = ativas.map(u => ({
    unidade: u,
    dentro: contar(a => a.modalidade === 'UNIDADE' && a.unidadeId === u.id),
    lugares: capacidadeOperacional(u, data, dow, capacidades),
  }));

  return (
    <Bloco
      titulo={`${DIAS_ABREV[dow]}, ${formatarData(data)}${feriado ? ` · ${feriado}` : ''}`}
      desc={`${trabalhando.length} pessoa(s) em atividade neste dia.`}
      acoes={<Link href={fecharHref} className="esc-btn esc-btn-ghost esc-btn-sm">Fechar</Link>}
    >
      {/* O que está errado neste dia, antes de qualquer outra coisa. Conflito
          é vermelho e alerta é âmbar, a mesma distinção da tela de geração:
          conflito quebra uma regra rígida, alerta é algo a olhar. Nenhum dos
          dois impede salvar — remanejar um mês às vezes passa por um estado
          inválido para chegar num válido. */}
      {(conflitos.length > 0 || alertas.length > 0) && (
        <div className="px-4 py-2.5 border-b space-y-1" style={{ borderColor: 'var(--line)' }}>
          {conflitos.map((c, i) => (
            <p key={`c${i}`} className="text-[11.5px] font-medium" style={{ color: 'var(--rose)' }}>
              {c.colaborador ? `${c.colaborador}: ` : ''}{c.msg}
            </p>
          ))}
          {alertas.map((a, i) => (
            <p key={`a${i}`} className="text-[11.5px]" style={{ color: 'var(--amber)' }}>
              {a.colaborador ? `${a.colaborador}: ` : ''}{a.msg}
            </p>
          ))}
        </div>
      )}

      <div className="px-4 py-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 border-b" style={{ borderColor: 'var(--line)' }}>
        {lotacao.map(({ unidade: u, dentro, lugares }) => {
          // Lotada é diferente de estourada: uma é o limite atingido, a outra
          // é o limite ultrapassado, e só a segunda é problema.
          const estourou = dentro > lugares;
          const cheia = dentro === lugares;
          return (
            <div
              key={u.id}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: estourou ? 'var(--rose)' : 'var(--line)' }}
            >
              <div className="esc-rotulo mb-1" style={{ color: u.cor }}>{u.nome}</div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-[20px] font-semibold esc-num leading-none"
                  style={{ color: estourou ? 'var(--rose)' : undefined }}
                >
                  {dentro}
                </span>
                <span className="text-[12px] esc-num" style={{ color: 'var(--muted)' }}>de {lugares}</span>
                {estourou && <Badge cor="var(--rose)" bg="var(--rose-bg)">estourou</Badge>}
                {cheia && !estourou && <Badge cor="var(--amber)" bg="var(--amber-bg)">lotada</Badge>}
              </div>
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
                  {/* `key` em children estáticos: eles atravessam a fronteira
                      servidor→cliente como array serializado, e nessa travessia
                      o React perde a marcação de "filhos fixos" e passa a cobrar
                      chave. Sem elas o console enche de aviso em toda abertura
                      de dia no calendário. */}
                  <td key="pessoa">
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
                  <td key="equipe" style={{ color: 'var(--muted)' }}>
                    {equipePorId.get(c.equipeId)?.nome ?? '—'}
                    <div className="text-[10.5px]">{c.cargo}</div>
                  </td>
                  <td key="alocacao">
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
                  <td key="horario" className="esc-num" style={{ color: 'var(--muted)' }}>
                    {['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade) ? '—' : faixaHoraria(c, dow)}
                  </td>
                </LinhaDoColaborador>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Trazer alguém para o dia.
          A tabela acima só lista quem já está escalado, então dava para MOVER e
          para tirar (mandando para folga), mas não para acrescentar: quem
          estava de descanso simplesmente não aparecia em lugar nenhum do
          painel. Para incluir a pessoa era preciso voltar ao plano do mês e
          gerar de novo — o que refaz o mês inteiro e desfaz os outros ajustes
          manuais. */}
      {podeEditar && foraDoDia.length > 0 && (
        <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <form action={reposicionarAlocacao} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="data" value={data} />
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="volta" value={volta} />
            <label className="block">
              <span className="esc-rotulo">Trazer para este dia</span>
              <select name="colaboradorId" className="esc-input w-56 py-1" aria-label="Quem trazer para este dia">
                {foraDoDia.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nome} — {equipePorId.get(c.equipeId)?.nome ?? 'sem equipe'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="esc-rotulo">Alocação</span>
              <select name="destino" className="esc-input w-48 py-1" aria-label="Alocação de quem entra">
                {ativas.map(u => <option key={u.id} value={`UNIDADE:${u.id}`}>{u.nome}</option>)}
                {(['HOME', 'EXTERNO', 'EVENTO', 'TREINA'] as const).map(m => (
                  <option key={m} value={m}>{MODALIDADES[m].label}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Adicionar</button>
          </form>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            {foraDoDia.length} pessoa(s) de folga ou sem escala neste dia. Quem está de férias ou afastado
            não aparece aqui — para trazer alguém nessa situação, a ausência precisa ser desfeita primeiro.
          </p>
        </div>
      )}

    </Bloco>
  );
}
