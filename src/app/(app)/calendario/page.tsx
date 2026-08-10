import Link from 'next/link';
import { getSessao, ehPlanejamento } from '@/lib/sessao';
import {
  carregarContextoMes, getGeracaoAtual, listarAlocacoes, listarOcorrencias,
} from '@/lib/data/escalas';
import {
  DIAS_ABREV, diaSemana, diasNoMes, formatarCompetencia, iso,
} from '@/lib/domain/escalas/datas';
import { MODALIDADES, STATUS_GERACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, comFiltros, texto, type Busca } from '@/lib/pagina';
import { mudarStatusEscala } from '@/app/actions-geracao';
import { Abas, Aviso, Bloco, Pill, Vazio, aparencia } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { FiltrosAuto } from '@/components/FiltrosAuto';
import { GradeDoMes } from '@/components/GradeDoMes';
import { DetalheDoDia } from '@/components/DetalheDoDia';

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  const competencia = competenciaDaBusca(busca);
  const planeja = ehPlanejamento(sessao.papel);

  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const geracao = await getGeracaoAtual(competencia);
  const alocacoes = geracao ? await listarAlocacoes(geracao.id) : [];

  const [ano, mes] = [ctx.ano, ctx.mes];
  const nDias = diasNoMes(ano, mes);
  const vista = texto(busca, 'vista') || 'mes';
  const dia = texto(busca, 'dia');

  const equipeFiltro = Number(texto(busca, 'equipe')) || null;
  const turnoFiltro = texto(busca, 'turno');
  const modalidadeFiltro = texto(busca, 'modalidade');
  const nomeFiltro = texto(busca, 'q').toLowerCase();

  const visiveis = ctx.colaboradores.filter(c => {
    if (equipeFiltro && c.equipeId !== equipeFiltro) return false;
    if (turnoFiltro && c.turno !== turnoFiltro) return false;
    if (nomeFiltro && !c.nome.toLowerCase().includes(nomeFiltro)) return false;
    return true;
  });
  const idsVisiveis = new Set(visiveis.map(c => c.id));

  const alocacoesFiltradas = alocacoes.filter(a => {
    if (!idsVisiveis.has(a.colaboradorId)) return false;
    if (!modalidadeFiltro) return true;
    if (modalidadeFiltro.startsWith('U:')) return a.modalidade === 'UNIDADE' && a.unidadeId === Number(modalidadeFiltro.slice(2));
    return a.modalidade === modalidadeFiltro;
  });

  const porDia = new Map<string, typeof alocacoesFiltradas>();
  for (const a of alocacoesFiltradas) porDia.set(a.data, [...(porDia.get(a.data) ?? []), a]);

  const conflitosPorDia = new Map<string, number>();
  for (const c of geracao?.conflitos ?? []) {
    if (c.data) conflitosPorDia.set(c.data, (conflitosPorDia.get(c.data) ?? 0) + 1);
  }

  const ocorrencias = await listarOcorrencias(competencia, iso(ano, mes, nDias));
  const base = comFiltros(busca, {});
  const href = (m: Record<string, string | null>) => `/calendario${comFiltros(busca, m)}`;

  if (!geracao) {
    return (
      <>
        <Cabecalho competencia={competencia} papel={sessao.papel} />
        <Bloco>
          <Vazio
            titulo={`Nenhuma escala gerada para ${formatarCompetencia(competencia)}`}
            desc={
              planeja
                ? 'Configure os planos do mês e rode a geração para ver o calendário aqui.'
                : 'Assim que o Planejamento publicar a escala deste mês, ela aparece aqui.'
            }
            acao={planeja ? <Link href={`/gerar?competencia=${competencia}`} className="esc-btn">Ir para a geração</Link> : undefined}
          />
        </Bloco>
      </>
    );
  }

  const statusCfg = STATUS_GERACAO[geracao.status];

  return (
    <>
      <Cabecalho competencia={competencia} papel={sessao.papel} />
      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <Bloco
        titulo={`Escala de ${formatarCompetencia(competencia)}`}
        desc={`Versão ${geracao.versao} · ${geracao.escopo} · gerada por ${geracao.geradaPorNome}. ${geracao.conflitos.length} conflito(s) e ${geracao.alertas.length} alerta(s).`}
        acoes={
          <>
            <Pill cor={statusCfg.cor} bg={statusCfg.bg}>{statusCfg.label}</Pill>
            {planeja && geracao.status !== 'encerrada' && (
              <form action={mudarStatusEscala}>
                <input type="hidden" name="competencia" value={competencia} />
                <input type="hidden" name="volta" value="/calendario" />
                <input type="hidden" name="status" value={geracao.status === 'rascunho' ? 'publicada' : 'encerrada'} />
                <button type="submit" className={`esc-btn esc-btn-sm ${geracao.status === 'rascunho' ? '' : 'esc-btn-outline'}`}>
                  {geracao.status === 'rascunho' ? 'Publicar para a equipe' : 'Encerrar o mês'}
                </button>
              </form>
            )}
          </>
        }
      >
        <div className="px-4 py-3 flex flex-wrap items-end gap-3 border-b" style={{ borderColor: 'var(--line)' }}>
          <form className="flex flex-wrap items-end gap-3" method="get">
              <FiltrosAuto />
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="vista" value={vista} />
            <label className="block">
              <span className="esc-rotulo">Colaborador</span>
              {/* `list` dá a lista suspensa e a busca ao mesmo tempo, nativas:
                  digitar filtra os nomes, e a seta abre todos. Continua aceitando
                  texto livre, então buscar por parte do nome segue funcionando. */}
              <input
                name="q"
                list="lista-colaboradores"
                defaultValue={texto(busca, 'q')}
                placeholder="Todos — digite para filtrar"
                autoComplete="off"
                className="esc-input w-56"
              />
              <datalist id="lista-colaboradores">
                {ctx.colaboradores
                  .filter(c => c.status === 'ativo')
                  .map(c => <option key={c.id} value={c.nome} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="esc-rotulo">Equipe</span>
              <select name="equipe" defaultValue={texto(busca, 'equipe')} className="esc-input w-44">
                <option value="">Todas</option>
                {ctx.equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="esc-rotulo">Modalidade</span>
              <select name="modalidade" defaultValue={modalidadeFiltro} className="esc-input w-44">
                <option value="">Todas</option>
                {ctx.unidades.filter(u => u.ativa).map(u => <option key={u.id} value={`U:${u.id}`}>{u.nome}</option>)}
                {(Object.keys(MODALIDADES) as (keyof typeof MODALIDADES)[])
                  .filter(m => m !== 'DESCANSO')
                  .map(m => <option key={m} value={m}>{MODALIDADES[m].label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="esc-rotulo">Turno</span>
              <select name="turno" defaultValue={turnoFiltro} className="esc-input w-32">
                <option value="">Todos</option>
                <option value="D">Diurno</option>
                <option value="N">Noturno</option>
              </select>
            </label>
            <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Aplicar</button>
            {(nomeFiltro || equipeFiltro || turnoFiltro || modalidadeFiltro) && (
              <Link href={`/calendario?competencia=${competencia}&vista=${vista}`} className="esc-btn esc-btn-ghost esc-btn-sm">
                Limpar
              </Link>
            )}
          </form>

          <div className="ml-auto">
            <Abas
              ativa={vista}
              itens={[
                { chave: 'mes', label: 'Calendário', href: href({ vista: 'mes', dia: null }) },
                { chave: 'grade', label: 'Grade do mês', href: href({ vista: 'grade', dia: null }) },
              ]}
            />
          </div>
        </div>

        {vista === 'grade' ? (
          <GradeDoMes
            ano={ano}
            mes={mes}
            competencia={competencia}
            colaboradores={visiveis}
            equipes={ctx.equipes}
            unidades={ctx.unidades}
            alocacoes={alocacoesFiltradas}
            feriados={ctx.feriados}
            capacidadeDia={Object.fromEntries(
              Array.from({ length: nDias }, (_, i) => {
                const data = iso(ano, mes, i + 1);
                return [data, Object.fromEntries(ctx.unidades.filter(u => u.ativa).map(u => {
                  const dow = diaSemana(ano, mes, i + 1);
                  const esp = ctx.capacidades.find(c => c.unidadeId === u.id && c.data === data);
                  const sem = ctx.capacidades.find(c => c.unidadeId === u.id && c.dow === dow);
                  const cfg = esp ?? sem ?? { total: u.capacidadeTotal, reservadas: u.capacidadeReservadas };
                  return [u.id, Math.max(0, cfg.total - cfg.reservadas)];
                }))];
              })
            )}
            baseHref={`/calendario${base}`}
          />
        ) : (
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {DIAS_ABREV.map(d => (
                <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-center py-1" style={{ color: 'var(--faint)' }}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: diaSemana(ano, mes, 1) }, (_, i) => <div key={`v${i}`} />)}
              {Array.from({ length: nDias }, (_, i) => {
                const d = i + 1;
                const data = iso(ano, mes, d);
                const doDia = porDia.get(data) ?? [];
                const fimDeSemana = [0, 6].includes(diaSemana(ano, mes, d));
                const feriado = ctx.feriados[data];
                const conflitos = conflitosPorDia.get(data) ?? 0;
                const contagem = new Map<string, { label: string; sigla: string; cor: string; bg: string; n: number }>();
                for (const a of doDia) {
                  if (a.modalidade === 'DESCANSO') continue;
                  const chave = a.modalidade === 'UNIDADE' ? `U${a.unidadeId}` : a.modalidade;
                  const ap = aparencia(a.modalidade, a.unidadeId, ctx.unidades);
                  const atual = contagem.get(chave);
                  contagem.set(chave, { ...ap, n: (atual?.n ?? 0) + 1 });
                }
                const linhas = [...contagem.values()].sort((a, b) => b.n - a.n).slice(0, 4);

                return (
                  <Link
                    key={data}
                    href={href({ dia: data, vista: 'mes' })}
                    className="rounded-lg border p-1.5 min-h-[92px] flex flex-col gap-1 transition-colors hover:border-[color:var(--brand-600)]"
                    style={{
                      background: dia === data ? 'var(--brand-50)' : fimDeSemana || feriado ? 'var(--bg)' : 'var(--surface)',
                      borderColor: dia === data ? 'var(--brand-600)' : 'var(--line)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[12px] font-semibold esc-num">{d}</span>
                      {conflitos > 0 && (
                        <span className="esc-badge esc-num" style={{ color: 'var(--rose)', background: 'var(--rose-bg)' }}>
                          {conflitos}
                        </span>
                      )}
                    </div>
                    {feriado && (
                      <span className="text-[9px] leading-tight truncate" style={{ color: 'var(--amber)' }} title={feriado}>
                        {feriado}
                      </span>
                    )}
                    <div className="space-y-0.5 mt-auto">
                      {linhas.map(l => (
                        <div key={l.sigla} className="flex items-center justify-between gap-1 text-[9.5px] font-semibold rounded px-1 py-px" style={{ background: l.bg, color: l.cor }}>
                          <span className="truncate">{l.sigla}</span>
                          <span className="esc-num">{l.n}</span>
                        </div>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </Bloco>

      {dia && (
        <DetalheDoDia
          data={dia}
          competencia={competencia}
          alocacoes={alocacoes.filter(a => a.data === dia)}
          colaboradores={ctx.colaboradores}
          equipes={ctx.equipes}
          unidades={ctx.unidades}
          ocorrencias={ocorrencias.filter(o => o.data === dia)}
          feriado={ctx.feriados[dia]}
          podeEditar={planeja && geracao.status !== 'encerrada'}
          podeLancarOcorrencia={sessao.papel !== 'colaborador'}
          fecharHref={`/calendario${comFiltros(busca, { dia: null })}`}
          volta="/calendario"
        />
      )}
    </>
  );
}

function Cabecalho({ competencia, papel }: { competencia: string; papel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Calendário da escala</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {papel === 'gestor' ? 'Escala da sua equipe' : 'Escala completa'} · {formatarCompetencia(competencia)}
        </p>
      </div>
      <SeletorMes competencia={competencia} />
    </div>
  );
}
