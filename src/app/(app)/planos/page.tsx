import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import { carregarContextoMes, colaboradoresDaEscala, listarCompetencias, pendenciasDoMes } from '@/lib/data/escalas';
import { DIAS_ABREV, addDias, formatarCompetencia, formatarData, iso, partesIso } from '@/lib/domain/escalas/datas';
import { competenciaDaBusca, comFiltros, texto, type Busca } from '@/lib/pagina';
import { copiarPlanosDoMes } from '@/app/actions-planos';
import { Aviso, Badge, Bloco, Stat, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { FiltrosAuto } from '@/components/FiltrosAuto';
import { EditorPlano } from '@/components/EditorPlano';

export default async function PlanosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel !== 'planejamento') redirect('/');

  const competencia = competenciaDaBusca(busca);
  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const pendencias = pendenciasDoMes(ctx);
  const competencias = await listarCompetencias();

  const [ano, mes] = partesIso(competencia);
  const anterior = iso(mes === 0 ? ano - 1 : ano, mes === 0 ? 11 : mes - 1, 1);
  const temAnterior = competencias.includes(anterior);

  // Equipe fora da escala não aparece aqui: não há plano a definir para quem o
  // motor não aloca.
  const ativos = colaboradoresDaEscala(ctx).filter(c => c.status === 'ativo');
  const planoPorColab = new Map(ctx.planos.map(p => [p.colaboradorId, p]));
  const herdados = ctx.planos.filter(p => p.herdadoDe).length;
  const equipePorId = new Map(ctx.equipes.map(e => [e.id, e]));
  const unidadePorId = new Map(ctx.unidades.map(u => [u.id, u]));
  const pendenciasPorColab = new Map<number, string[]>();
  for (const p of pendencias) pendenciasPorColab.set(p.colaboradorId, [...(pendenciasPorColab.get(p.colaboradorId) ?? []), p.msg]);

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
  const colabEmEdicao = emEdicao ? ctx.colaboradores.find(c => c.id === emEdicao) : null;

  const ausenciasPorColab = new Map<number, typeof ctx.ausencias>();
  for (const a of ctx.ausencias) ausenciasPorColab.set(a.colaboradorId, [...(ausenciasPorColab.get(a.colaboradorId) ?? []), a]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Planos do mês</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Distribuição por unidade, home office, ciclo 12x36, férias e ausências — {formatarCompetencia(competencia)}
          </p>
        </div>
        <SeletorMes competencia={competencia} />
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Planos em vigor"
          valor={`${ctx.planos.length}/${ativos.length}`}
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
        <Stat label="Ausências no mês" valor={ctx.ausencias.length} sub="Inclui férias e ausências em curso" />
      </div>

      {colabEmEdicao && (
        <EditorPlano
          colaborador={colabEmEdicao}
          plano={planoPorColab.get(colabEmEdicao.id) ?? null}
          ausencias={ausenciasPorColab.get(colabEmEdicao.id) ?? []}
          unidades={ctx.unidades.filter(u => u.ativa)}
          postos={ctx.postos}
          competencia={competencia}
          pendencias={pendenciasPorColab.get(colabEmEdicao.id) ?? []}
          fecharHref={`/planos${comFiltros(busca, { colab: null })}`}
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
              {ctx.equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
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
                          <span style={{ color: 'var(--faint)' }}>—</span>
                        ) : p?.ciclo ? (
                          <Badge cor="var(--brand-700)" bg="var(--brand-100)">
                            {p.ciclo === 'IMPAR' ? 'Ímpares' : 'Pares'}
                          </Badge>
                        ) : (
                          <Badge cor="var(--rose)" bg="var(--rose-bg)">Definir</Badge>
                        )}
                      </td>
                      <td>
                        {p && Object.keys(p.distribuicao).length ? (
                          <div className="flex flex-wrap gap-1">
                            {ctx.unidades.filter(u => u.ativa && (p.distribuicao[u.id] ?? 0) > 0).map(u => (
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
                          href={`/planos${comFiltros(busca, { colab: String(c.id) })}`}
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
