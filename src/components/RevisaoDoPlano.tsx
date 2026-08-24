import Link from 'next/link';
import {
  DIAS_ABREV, addDias, cicloDoMes, formatarCompetencia, formatarData,
} from '@/lib/domain/escalas/datas';
import { comFiltros, texto, type Busca } from '@/lib/pagina';
import { copiarPlanosDoMes } from '@/app/actions-planos';
import { Badge, Bloco, Stat, Vazio } from '@/components/Ui';
import { FiltrosAuto } from '@/components/FiltrosAuto';
import { EditorPlano } from '@/components/EditorPlano';
import type { Ausencia, Colaborador, Equipe, PlanoMensal, Posto, Unidade } from '@/lib/domain/escalas/tipos';

interface Props {
  competencia: string;
  busca: Busca;
  /** Rota que hospeda esta revisão — os links de editar e fechar voltam para ela. */
  baseHref: string;
  colaboradores: Colaborador[];
  equipes: Equipe[];
  unidades: Unidade[];
  postos: Posto[];
  planos: PlanoMensal[];
  ausencias: Ausencia[];
  cicloAncora: string;
  pendencias: { colaboradorId: number; colaborador: string; msg: string }[];
  /** Competência anterior, quando existe plano lá para ser fixado aqui. */
  anterior: string | null;
}

/**
 * Revisão do plano do mês: uma linha por pessoa com o que o motor vai usar.
 *
 * Vivia dentro da página `/planos`, que era um destino separado no menu. O
 * fluxo de gerar a escala começa justamente por conferir estes planos, e ter
 * as duas coisas em telas distintas obrigava a ir e voltar sem que nada na
 * tela dissesse que uma era pré-requisito da outra. Agora isto é a primeira
 * etapa do fluxo, e a página antiga redireciona para cá.
 *
 * Não há diagnóstico de escala aqui — nem conflito, nem alerta, nem aderência.
 * Eles descrevem uma escala, e nesta etapa ela ainda não existe. O que aparece
 * é só o que impede de gerar: as PENDÊNCIAS, que são buracos no plano.
 */
export function RevisaoDoPlano({
  competencia, busca, baseHref, colaboradores, equipes, unidades, postos,
  planos, ausencias, cicloAncora, pendencias, anterior,
}: Props) {
  const ativos = colaboradores.filter(c => c.status === 'ativo');
  const planoPorColab = new Map(planos.map(p => [p.colaboradorId, p]));
  const herdados = planos.filter(p => p.herdadoDe).length;
  const equipePorId = new Map(equipes.map(e => [e.id, e]));
  const unidadePorId = new Map(unidades.map(u => [u.id, u]));

  const ausenciasPorColab = new Map<number, Ausencia[]>();
  for (const a of ausencias) {
    ausenciasPorColab.set(a.colaboradorId, [...(ausenciasPorColab.get(a.colaboradorId) ?? []), a]);
  }

  const pendenciasPorColab = new Map<number, string[]>();
  for (const p of pendencias) {
    pendenciasPorColab.set(p.colaboradorId, [...(pendenciasPorColab.get(p.colaboradorId) ?? []), p.msg]);
  }

  const equipeFiltro = Number(texto(busca, 'equipe')) || null;
  const nomeFiltro = texto(busca, 'q').toLowerCase();
  const soPendentes = texto(busca, 'pendentes') === '1';

  const listados = ativos.filter(c => {
    if (equipeFiltro && c.equipeId !== equipeFiltro) return false;
    if (nomeFiltro && !c.nome.toLowerCase().includes(nomeFiltro)) return false;
    if (soPendentes && !pendenciasPorColab.has(c.id)) return false;
    return true;
  });

  const emEdicao = Number(texto(busca, 'colab')) || null;
  const colabEmEdicao = emEdicao ? colaboradores.find(c => c.id === emEdicao) : null;
  const temAnterior = !!anterior;

  return (
    <>
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat
        label="Planos em vigor"
        valor={`${planos.length}/${ativos.length}`}
        sub={herdados > 0
          ? `${herdados} herdado(s) de meses anteriores`
          : 'Todos definidos neste mês'}
      />
      <Stat
        label="Pendências"
        valor={pendencias.length}
        sub={pendencias.length ? 'Bloqueiam a geração do mês' : 'Nenhuma — pode gerar'}
        cor="var(--rose)"
        alerta={pendencias.length > 0}
      />
      <Stat label="Ausências no mês" valor={ausencias.length} sub="Inclui férias e ausências em curso" />
    </div>

    {colabEmEdicao && (
      <EditorPlano
        colaborador={colabEmEdicao}
        plano={planoPorColab.get(colabEmEdicao.id) ?? null}
        ausencias={ausenciasPorColab.get(colabEmEdicao.id) ?? []}
        unidades={unidades.filter(u => u.ativa)}
        postos={postos}
        competencia={competencia}
        cicloDoMes={cicloDoMes(
          planoPorColab.get(colabEmEdicao.id) ?? null,
          colabEmEdicao.ciclo,
          competencia,
          cicloAncora,
        )}
        pendencias={pendenciasPorColab.get(colabEmEdicao.id) ?? []}
        fecharHref={`${baseHref}${comFiltros(busca, { colab: null })}`}
      />
    )}

    <Bloco
      titulo={`${listados.length} colaborador(es)`}
      desc={
        'Cada linha resume o que o motor vai usar neste mês. Sem plano em lugar nenhum, o colaborador '
        + 'cai 100% na unidade base; quem tem plano de um mês anterior o carrega para cá, exceto férias '
        + 'e ausências, que vêm das solicitações aprovadas.'
      }
      acoes={
        // Herdar já acontece sozinho. Fixar serve para congelar: um plano
        // herdado acompanha o mês de origem se ele for editado depois, e às
        // vezes é justamente isso que não se quer.
        temAnterior && herdados > 0 ? (
          <form action={copiarPlanosDoMes}>
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="origem" value={anterior} />
            <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">
              Fixar aqui as regras de {formatarCompetencia(anterior)}
            </button>
          </form>
        ) : undefined
      }
    >
      <form method="get" className="px-4 py-3 flex flex-wrap items-end gap-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <FiltrosAuto />
        <input type="hidden" name="competencia" value={competencia} />
        <label className="block">
          <span className="esc-rotulo">Buscar</span>
          <input name="q" defaultValue={texto(busca, 'q')} placeholder="Nome" className="esc-input w-48" />
        </label>
        <label className="block">
          <span className="esc-rotulo">Equipe</span>
          <select name="equipe" defaultValue={texto(busca, 'equipe')} className="esc-input w-48">
            <option value="">Todas</option>
            {equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] pb-1.5">
          <input type="checkbox" name="pendentes" value="1" defaultChecked={soPendentes} />
          Só com pendência
        </label>
        <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Aplicar</button>
      </form>

      {listados.length === 0 ? (
        <Vazio titulo="Nenhum colaborador nesse filtro" desc="Ajuste a busca ou cadastre colaboradores em Cadastros." />
      ) : (
        <div className="overflow-x-auto">
          <table className="esc-tabela">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Equipe · Regime</th>
                <th>Ciclo</th>
                <th>Distribuição</th>
                <th>Unidades fixas</th>
                <th>Home office</th>
                <th>Férias e ausências</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listados.map(c => {
                const p = planoPorColab.get(c.id);
                const equipe = equipePorId.get(c.equipeId);
                const pends = pendenciasPorColab.get(c.id) ?? [];
                const aus = ausenciasPorColab.get(c.id) ?? [];
                const ho = p?.homeOffice;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="font-medium flex items-center gap-1.5 flex-wrap">
                        {c.nome}
                        {p?.herdadoDe && (
                          <Badge cor="var(--muted)" bg="var(--bg)">
                            herda {formatarCompetencia(p.herdadoDe)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                        {c.cargo} · entrada {c.entrada}
                      </div>
                      {pends.length > 0 && (
                        <div className="mt-1 text-[10.5px] leading-snug" style={{ color: 'var(--rose)' }}>
                          {pends[0]}
                          {pends.length > 1 ? ` (+${pends.length - 1})` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {equipe?.nome ?? '—'}
                      <div className="text-[10.5px]">{c.regime} · {c.turno === 'N' ? 'noturno' : 'diurno'}</div>
                    </td>
                    <td>
                      {c.regime !== '12x36' ? (
                        // Só o 12x36 tem paridade. Para o 5x2 o campo não
                        // significa nada, e mostrar "Definir" mandaria o
                        // Planejamento preencher o que não existe.
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      ) : p?.ciclo ? (
                        <Badge cor="var(--brand-700)" bg="var(--brand-100)">
                          {/* A paridade DESTE mês, não a que está gravada: um
                              plano herdado de um mês de 31 dias entra virado
                              aqui, e mostrar o valor cru faria a coluna
                              discordar da escala que o motor gera. */}
                          {cicloDoMes(p, c.ciclo, competencia, cicloAncora) === 'IMPAR' ? 'Ímpares' : 'Pares'}
                        </Badge>
                      ) : (
                        <Badge cor="var(--rose)" bg="var(--rose-bg)">Definir</Badge>
                      )}
                    </td>
                    <td>
                      {p && Object.keys(p.distribuicao).length ? (
                        <div className="flex flex-wrap gap-1">
                          {unidades.filter(u => u.ativa && (p.distribuicao[u.id] ?? 0) > 0).map(u => (
                            <Badge key={u.id} cor={u.cor} bg={u.bg}>{u.sigla} {p.distribuicao[u.id]}%</Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge cor="var(--amber)" bg="var(--amber-bg)">Sem plano</Badge>
                      )}
                    </td>
                    <td>
                      {p && Object.keys(p.unidadesFixas).length ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(p.unidadesFixas).map(([dow, uid]) => {
                            const u = unidadePorId.get(uid);
                            return (
                              <Badge key={dow} cor={u?.cor ?? '#334155'} bg={u?.bg ?? 'var(--bg)'}>
                                {DIAS_ABREV[Number(dow)]} {u?.sigla}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {!c.elegHome ? (
                        <span style={{ color: 'var(--faint)' }}>Não elegível</span>
                      ) : ho?.modo === 'FIXO' ? (
                        `Fixo · ${ho.diasSemana.map(d => DIAS_ABREV[d]).join(', ')}`
                      ) : ho?.modo === 'COTA' ? (
                        `Cota · ${ho.quantidade}x por semana`
                      ) : (
                        <span style={{ color: 'var(--faint)' }}>Sem home office</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {aus.length === 0 ? (
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {aus.slice(0, 2).map(a => (
                            <div key={a.id} className="text-[10.5px]">
                              {a.tipo === 'FERIAS' ? 'Férias' : `${a.grupo} — ${a.motivo}`}:{' '}
                              {formatarData(a.inicio)} a {formatarData(addDias(a.inicio, a.dias - 1))}
                            </div>
                          ))}
                          {aus.length > 2 && <div className="text-[10.5px]">+{aus.length - 2}</div>}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`${baseHref}${comFiltros(busca, { colab: String(c.id) })}`}
                        className="esc-btn esc-btn-outline esc-btn-sm"
                      >
                        {p ? 'Editar' : 'Configurar'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
    </>
  );
}
