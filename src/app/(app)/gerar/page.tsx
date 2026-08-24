import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao, podeEditarEscala } from '@/lib/sessao';
import {
  carregarContextoMes, colaboradoresDaEscala, getGeracaoAtual, listarAlocacoes,
  listarOcorrencias, pendenciasDoMes,
} from '@/lib/data/escalas';
import { conferirAlocacoes } from '@/lib/domain/escalas/conferencia';
import { diaSemana, diasNoMes, formatarCompetencia, formatarData, iso, partesIso } from '@/lib/domain/escalas/datas';
import { REGRAS_MOTOR, STATUS_GERACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, comFiltros, texto, type Busca } from '@/lib/pagina';
import { gerarEscalaDoMes, liberarTodasAsTravas, mudarStatusEscala } from '@/app/actions-geracao';
import { Aviso, Bloco, ListaAvisos, Pill, Stat, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { PassosDaEscala } from '@/components/PassosDaEscala';
import { RevisaoDoPlano } from '@/components/RevisaoDoPlano';
import { GradeDoMes } from '@/components/GradeDoMes';
import { DetalheDoDia } from '@/components/DetalheDoDia';

/**
 * O mês inteiro num fluxo só: revisar o plano, gerar, revisar a escala,
 * publicar.
 *
 * Antes eram dois destinos de menu ("Planos do mês" e "Gerar escala") mais o
 * calendário, e a ordem entre eles existia só na cabeça de quem já sabia. Dava
 * para abrir a geração antes de revisar o plano e receber um bloqueio sem
 * contexto; e o ajuste manual — o passo mais importante antes de publicar —
 * ficava atrás de um link para outra tela.
 *
 * A etapa não é escolhida livremente: ela é DERIVADA do estado do mês, e o
 * parâmetro `etapa` só vence quando aquela etapa já está liberada. Assim a tela
 * nunca oferece "publicar" para um mês sem escala, nem "revisar a escala" antes
 * de existir uma.
 *
 * Onde o diagnóstico aparece é decisão de desenho, não acaso: conflito, alerta
 * e aderência descrevem uma ESCALA, e na etapa do plano ela ainda não existe.
 * Antecipá-los ali obrigava a interpretar a simulação de algo que ninguém
 * mandou gerar. Na etapa 3 eles saem do que está gravado — recalculados a cada
 * ajuste manual, e não lembrados da geração.
 */
export default async function GerarPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel !== 'planejamento') redirect('/');

  const competencia = competenciaDaBusca(busca);
  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const geracao = await getGeracaoAtual(competencia);
  const pendencias = pendenciasDoMes(ctx);

  const ativos = colaboradoresDaEscala(ctx).filter(c => c.status === 'ativo');
  const [ano, mes] = partesIso(competencia);
  const nDias = diasNoMes(ano, mes);

  const anteriorIso = iso(mes === 0 ? ano - 1 : ano, mes === 0 ? 11 : mes - 1, 1);
  const temPlanoHerdado = ctx.planos.some(p => p.herdadoDe);

  // ── Que etapas estão liberadas ────────────────────────────────
  const podeGerar = pendencias.length === 0 && ativos.length > 0;
  const temEscala = !!geracao;
  const publicada = geracao?.status === 'publicada' || geracao?.status === 'encerrada';

  const passos = [
    { chave: 'plano', numero: 1, titulo: 'Revisar o plano do mês', liberado: true, concluido: podeGerar },
    { chave: 'gerar', numero: 2, titulo: 'Gerar a escala', liberado: podeGerar, concluido: temEscala },
    { chave: 'revisar', numero: 3, titulo: 'Revisar e ajustar', liberado: temEscala, concluido: publicada },
    { chave: 'publicar', numero: 4, titulo: 'Publicar', liberado: temEscala, concluido: publicada },
  ];

  // A etapa que o estado sugere. O pedido explícito só vence se ela estiver
  // liberada — um link velho para `?etapa=publicar` num mês sem escala cairia
  // numa tela vazia sem dizer por quê.
  //
  // Mês sem escala abre na REVISÃO DO PLANO, mesmo quando não há pendência
  // nenhuma. Pular direto para o botão de gerar economizaria um clique e
  // tiraria a conferência do caminho: o plano completo é o que o motor vai
  // obedecer, e olhá-lo antes é justamente o passo que evita descobrir o erro
  // depois de a escala existir. Quem já conferiu avança pelo próprio botão.
  const sugerida = !temEscala ? 'plano' : publicada ? 'publicar' : 'revisar';
  const pedida = texto(busca, 'etapa');
  const etapa = passos.find(p => p.chave === pedida && p.liberado) ? pedida : sugerida;

  const href = (chave: string) => `/gerar${comFiltros(busca, { etapa: chave, dia: null, colab: null })}`;

  // ── Diagnóstico: só quando há escala, e sempre sobre o que está gravado ──
  const alocacoes = geracao ? await listarAlocacoes(geracao.id) : [];
  const diagnostico = geracao
    ? conferirAlocacoes({
        alocacoes,
        colaboradores: ctx.colaboradores,
        equipes: ctx.equipes,
        unidades: ctx.unidades,
        capacidades: ctx.capacidades,
        cotasEquipe: ctx.cotasEquipe,
        ausencias: ctx.ausencias,
        coberturaMinima: ctx.config.coberturaMinima,
      })
    : { conflitos: [], alertas: [] };

  const aderentes = geracao ? geracao.aderencia.filter(a => a.ok).length : 0;
  const dia = texto(busca, 'dia');
  const ocorrencias = geracao ? await listarOcorrencias(competencia, iso(ano, mes, nDias)) : [];

  const cabecalho = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Escala de {formatarCompetencia(competencia)}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Do plano à publicação, na ordem.
          </p>
        </div>
        <SeletorMes competencia={competencia} />
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <PassosDaEscala passos={passos} atual={etapa} href={href} />
    </>
  );

  if (ativos.length === 0) {
    return (
      <>
        {cabecalho}
        <Bloco>
          <Vazio
            titulo="Nenhum colaborador ativo cadastrado"
            desc="Cadastre as unidades, as equipes e os colaboradores antes de montar a primeira escala."
            acao={<Link href="/parametros" className="esc-btn">Configurar parâmetros</Link>}
          />
        </Bloco>
      </>
    );
  }

  return (
    <>
      {cabecalho}

      {/* ══════════ 1. Revisar o plano ══════════ */}
      {etapa === 'plano' && (
        <>
          {pendencias.length > 0 ? (
            <Bloco
              titulo={`${pendencias.length} pendência(s) impedem a geração`}
              desc="Gerar sobre um plano incompleto produz uma escala que parece válida e não é. Cada nome abaixo abre o plano dele."
            >
              <ul className="divide-y max-h-72 overflow-auto" style={{ borderColor: 'var(--line)' }}>
                {pendencias.slice(0, 60).map((p, i) => (
                  <li key={i} className="px-4 py-2 text-[12px]">
                    <Link
                      href={`/gerar${comFiltros(busca, { etapa: 'plano', colab: String(p.colaboradorId) })}`}
                      className="font-semibold hover:underline"
                      style={{ color: 'var(--brand-700)' }}
                    >
                      {p.colaborador}
                    </Link>
                    <span style={{ color: 'var(--muted)' }}> · {p.msg}</span>
                  </li>
                ))}
                {pendencias.length > 60 && (
                  <li className="px-4 py-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    e mais {pendencias.length - 60} pendência(s).
                  </li>
                )}
              </ul>
            </Bloco>
          ) : (
            <div
              className="esc-card px-4 py-3 flex flex-wrap items-center gap-3"
              style={{ borderLeft: '3px solid var(--green)', background: 'var(--green-bg)' }}
            >
              <span className="text-[12.5px] font-medium" style={{ color: 'var(--green)' }}>
                Plano completo — {ativos.length} pessoa(s) prontas para entrar na escala.
              </span>
              <Link href={href('gerar')} className="esc-btn esc-btn-sm ml-auto">
                Ir para a geração
              </Link>
            </div>
          )}

          <RevisaoDoPlano
            competencia={competencia}
            busca={busca}
            baseHref="/gerar"
            colaboradores={ctx.colaboradores}
            equipes={ctx.equipes}
            unidades={ctx.unidades}
            postos={ctx.postos}
            planos={ctx.planos}
            ausencias={ctx.ausencias}
            cicloAncora={ctx.config.cicloAncora}
            pendencias={pendencias}
            anterior={temPlanoHerdado ? anteriorIso : null}
          />
        </>
      )}

      {/* ══════════ 2. Gerar ══════════ */}
      {etapa === 'gerar' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Colaboradores na escala" valor={ativos.length} sub={`${ctx.equipes.length} equipe(s)`} />
            <Stat label="Planos conferidos" valor={`${ctx.planos.length}/${ativos.length}`} sub="Sem pendências" />
            <Stat label="Alocações travadas" valor={ctx.pins.length} sub="Sobrevivem à regeração" />
          </div>

          <Bloco
            titulo={geracao ? `Regerar ${formatarCompetencia(competencia)}` : `Gerar ${formatarCompetencia(competencia)}`}
            desc={
              geracao
                ? `Cria a versão ${geracao.versao + 1}. As alocações travadas são preservadas; todo o resto é recalculado do zero.`
                : 'Grava a primeira versão do mês como rascunho. Nada fica visível para os colaboradores até você publicar.'
            }
          >
            <form action={gerarEscalaDoMes} className="px-4 py-4 flex flex-wrap items-center gap-3">
              <input type="hidden" name="competencia" value={competencia} />
              <button type="submit" className="esc-btn">
                {geracao ? 'Regerar o mês' : 'Gerar a escala'}
              </button>
              <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Depois de gerar você revisa dia a dia antes de publicar.
              </span>
            </form>

            {ctx.pins.length > 0 && (
              <form action={liberarTodasAsTravas} className="px-4 pb-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="competencia" value={competencia} />
                <input type="hidden" name="volta" value="/gerar" />
                <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">
                  Liberar as {ctx.pins.length} trava(s) do mês
                </button>
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Depois disso, a próxima geração decide tudo de novo.
                </span>
              </form>
            )}
          </Bloco>

          <Bloco
            titulo="Precedência aplicada pelo motor"
            desc="As regras rodam nesta ordem. As rígidas nunca são violadas; as flexíveis são otimizadas dentro do que sobra."
          >
            <ol className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {REGRAS_MOTOR.map(r => (
                <li key={r.n} className="px-4 py-2.5 flex gap-3">
                  <span
                    className="shrink-0 w-6 h-6 rounded-md grid place-items-center text-[11px] font-semibold esc-num"
                    style={{ background: 'var(--brand-100)', color: 'var(--brand-800)' }}
                  >
                    {r.n}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-semibold">{r.titulo}</span>
                      <span
                        className="esc-badge"
                        style={
                          r.rigida
                            ? { color: 'var(--rose)', background: 'var(--rose-bg)' }
                            : { color: 'var(--muted)', background: 'var(--bg)' }
                        }
                      >
                        {r.rigida ? 'Rígida' : 'Flexível'}
                      </span>
                    </div>
                    <p className="text-[11.5px] leading-snug mt-0.5" style={{ color: 'var(--muted)' }}>{r.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Bloco>
        </>
      )}

      {/* ══════════ 3. Revisar e ajustar ══════════ */}
      {etapa === 'revisar' && geracao && (
        <>
          {/* O diagnóstico da escala aparece aqui, e só aqui: ele descreve o que
              foi gerado. Sai do que está no banco AGORA — depois de um ajuste
              manual, os números guardados na geração descreveriam outra escala. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Conflitos"
              valor={diagnostico.conflitos.length}
              sub={diagnostico.conflitos.length ? 'Regra rígida violada' : 'Nenhuma regra rígida violada'}
              cor="var(--rose)"
              alerta={diagnostico.conflitos.length > 0}
            />
            <Stat
              label="Alertas"
              valor={diagnostico.alertas.length}
              sub={diagnostico.alertas.length ? 'Vale conferir' : 'Nada a conferir'}
              cor="var(--amber)"
              alerta={diagnostico.alertas.length > 0}
            />
            <Stat
              label="Planos aderentes"
              valor={`${aderentes}/${geracao.aderencia.length}`}
              sub="Distribuição dentro da tolerância"
            />
          </div>

          {(diagnostico.conflitos.length > 0 || diagnostico.alertas.length > 0) && (
            <Bloco
              titulo="O que o motor apontou"
              desc="Conflito quebra uma regra rígida; alerta é algo a olhar. Nenhum dos dois impede publicar — quem decide é você."
            >
              <ListaAvisos itens={[...diagnostico.conflitos, ...diagnostico.alertas]} limite={30} />
            </Bloco>
          )}

          {geracao.status === 'rascunho' && (
            <div
              className="esc-card px-4 py-3 text-[12.5px] leading-relaxed"
              style={{ borderLeft: '3px solid var(--brand-700)', background: 'var(--brand-50)' }}
            >
              <strong>Ainda é rascunho — os colaboradores não enxergam esta escala.</strong>{' '}
              Clique em qualquer dia da grade para abrir o painel: ali você move uma pessoa de unidade,
              tira do dia ou traz alguém que estava de folga. O ajuste fica <strong>travado</strong>,
              sobrevive a uma nova geração, e os números acima se refazem a cada mudança.
            </div>
          )}

          {dia && (
            <DetalheDoDia
              data={dia}
              competencia={competencia}
              alocacoes={alocacoes.filter(a => a.data === dia)}
              colaboradores={ctx.colaboradores}
              equipes={ctx.equipes}
              unidades={ctx.unidades}
              postos={ctx.postos}
              ocorrencias={ocorrencias.filter(o => o.data === dia)}
              capacidades={ctx.capacidades}
              conflitos={diagnostico.conflitos.filter(c => c.data === dia)}
              alertas={diagnostico.alertas.filter(a => a.data === dia)}
              feriado={ctx.feriados[dia]}
              podeEditar={podeEditarEscala(sessao.papel, geracao.status)}
              podeLancarOcorrencia={geracao.status !== 'rascunho'}
              fecharHref={`/gerar${comFiltros(busca, { dia: null })}`}
              volta="/gerar"
            />
          )}

          <Bloco
            titulo={`Versão ${geracao.versao} · ${formatarCompetencia(competencia)}`}
            desc={`${geracao.escopo} · gerada em ${formatarData(geracao.geradaEm.slice(0, 10))} por ${geracao.geradaPorNome}. Clique num dia para ajustar.`}
            acoes={
              <>
                <Pill cor={STATUS_GERACAO[geracao.status].cor} bg={STATUS_GERACAO[geracao.status].bg}>
                  {STATUS_GERACAO[geracao.status].label}
                </Pill>
                <Link href={href('publicar')} className="esc-btn esc-btn-sm">
                  Ir para a publicação
                </Link>
              </>
            }
          >
            <GradeDoMes
              ano={ano}
              mes={mes}
              competencia={competencia}
              colaboradores={ativos}
              equipes={ctx.equipes}
              unidades={ctx.unidades}
              alocacoes={alocacoes}
              feriados={ctx.feriados}
              capacidadeDia={Object.fromEntries(
                Array.from({ length: nDias }, (_, i) => {
                  const data = iso(ano, mes, i + 1);
                  const dow = diaSemana(ano, mes, i + 1);
                  return [data, Object.fromEntries(ctx.unidades.filter(u => u.ativa).map(u => {
                    const esp = ctx.capacidades.find(c => c.unidadeId === u.id && c.data === data);
                    const sem = ctx.capacidades.find(c => c.unidadeId === u.id && !c.data && c.dow === dow);
                    const cfg = esp ?? sem ?? { total: u.capacidadeTotal, reservadas: u.capacidadeReservadas };
                    return [u.id, Math.max(0, cfg.total - cfg.reservadas)];
                  }))];
                })
              )}
              baseHref={`/gerar${comFiltros(busca, { etapa: 'revisar', dia: null })}`}
            />
          </Bloco>
        </>
      )}

      {/* ══════════ 4. Publicar ══════════ */}
      {etapa === 'publicar' && geracao && (
        <>
          <Bloco
            titulo={
              geracao.status === 'rascunho'
                ? 'Publicar para a equipe'
                : `Escala ${STATUS_GERACAO[geracao.status].label.toLowerCase()}`
            }
            desc={
              geracao.status === 'rascunho'
                ? 'A partir da publicação cada colaborador passa a ver os próprios dias, e as alterações seguintes vão para a caixa de saída antes de serem comunicadas.'
                : `Versão ${geracao.versao}. Ajustes continuam possíveis pelo painel do dia — eles são comunicados quando você confirmar.`
            }
            acoes={
              <Pill cor={STATUS_GERACAO[geracao.status].cor} bg={STATUS_GERACAO[geracao.status].bg}>
                {STATUS_GERACAO[geracao.status].label}
              </Pill>
            }
          >
            <div className="px-4 py-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div
                  className="rounded-lg px-3 py-2"
                  style={{ background: diagnostico.conflitos.length ? 'var(--rose-bg)' : 'var(--green-bg)' }}
                >
                  <div
                    className="esc-rotulo"
                    style={{ color: diagnostico.conflitos.length ? 'var(--rose)' : 'var(--green)' }}
                  >
                    Conflitos
                  </div>
                  <div
                    className="text-[22px] font-semibold esc-num"
                    style={{ color: diagnostico.conflitos.length ? 'var(--rose)' : 'var(--green)' }}
                  >
                    {diagnostico.conflitos.length}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--amber-bg)' }}>
                  <div className="esc-rotulo" style={{ color: 'var(--amber)' }}>Alertas</div>
                  <div className="text-[22px] font-semibold esc-num" style={{ color: 'var(--amber)' }}>
                    {diagnostico.alertas.length}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                  <div className="esc-rotulo">Aderentes</div>
                  <div className="text-[22px] font-semibold esc-num">{aderentes}/{geracao.aderencia.length}</div>
                </div>
              </div>

              {geracao.status === 'rascunho' && diagnostico.conflitos.length > 0 && (
                <p className="text-[12px]" style={{ color: 'var(--rose)' }}>
                  Há {diagnostico.conflitos.length} conflito(s) em aberto. Publicar continua possível — a
                  decisão é sua —, mas vale{' '}
                  <Link href={href('revisar')} className="font-semibold underline" style={{ color: 'var(--rose)' }}>
                    voltar e revisar
                  </Link>{' '}
                  antes.
                </p>
              )}

              {geracao.status !== 'encerrada' && (
                <form action={mudarStatusEscala} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="competencia" value={competencia} />
                  <input type="hidden" name="volta" value="/gerar" />
                  <input type="hidden" name="status" value={geracao.status === 'rascunho' ? 'publicada' : 'encerrada'} />
                  <button type="submit" className={`esc-btn ${geracao.status === 'rascunho' ? '' : 'esc-btn-outline'}`}>
                    {geracao.status === 'rascunho' ? 'Publicar a escala' : 'Encerrar o mês'}
                  </button>
                  <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    {geracao.status === 'rascunho'
                      ? 'Todo mundo passa a ver os próprios dias.'
                      : 'Mês encerrado não recebe mais ajustes.'}
                  </span>
                </form>
              )}
            </div>
          </Bloco>

          <div className="esc-card px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              A escala publicada fica no calendário, com filtros e visão por pessoa.
            </span>
            <Link
              href={`/calendario?competencia=${competencia}`}
              className="esc-btn esc-btn-outline esc-btn-sm ml-auto"
            >
              Abrir no calendário
            </Link>
          </div>
        </>
      )}
    </>
  );
}
