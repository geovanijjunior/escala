import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import { carregarContextoMes, getGeracaoAtual, pendenciasDoMes, simular } from '@/lib/data/escalas';
import { formatarCompetencia, formatarData } from '@/lib/domain/escalas/datas';
import { REGRAS_MOTOR, STATUS_GERACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, texto, type Busca } from '@/lib/pagina';
import { gerarEscalaDoMes, liberarTodasAsTravas, mudarStatusEscala } from '@/app/actions-geracao';
import { Aviso, Bloco, ListaAvisos, Pill, Stat, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';

export default async function GerarPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel !== 'planejamento') redirect('/');

  const competencia = competenciaDaBusca(busca);
  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const geracao = await getGeracaoAtual(competencia);
  const pendencias = pendenciasDoMes(ctx);

  // A simulação roda com os mesmos dados da geração definitiva — é literalmente
  // a mesma função. O que muda é só gravar ou não o resultado.
  const previa = pendencias.length === 0 ? simular(ctx) : null;
  const ativos = ctx.colaboradores.filter(c => c.status === 'ativo');
  const aDefinir = previa ? previa.alocacoes.filter(a => a.modalidade !== 'DESCANSO').length : 0;
  const aderentes = previa ? previa.aderencia.filter(a => a.ok).length : 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Gerar a escala do mês</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Simule, revise os conflitos e só então grave — {formatarCompetencia(competencia)}
          </p>
        </div>
        <SeletorMes competencia={competencia} />
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      {ativos.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Nenhum colaborador ativo cadastrado"
            desc="Cadastre as unidades, as equipes e os colaboradores antes de gerar a primeira escala."
            acao={<Link href="/parametros" className="esc-btn">Configurar parâmetros</Link>}
          />
        </Bloco>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Colaboradores ativos" valor={ativos.length} sub={`${ctx.equipes.length} equipe(s)`} />
            <Stat
              label="Pendências nos planos"
              valor={pendencias.length}
              sub={pendencias.length ? 'Bloqueiam a geração' : 'Tudo pronto para gerar'}
              cor="var(--rose)"
              alerta={pendencias.length > 0}
            />
            <Stat
              label="Conflitos na simulação"
              valor={previa?.conflitos.length ?? '—'}
              sub="Precisam de decisão manual"
              cor="var(--amber)"
              alerta={(previa?.conflitos.length ?? 0) > 0}
            />
            <Stat label="Alocações travadas" valor={ctx.pins.length} sub="Sobrevivem à regeração" />
          </div>

          {pendencias.length > 0 && (
            <Bloco
              titulo={`${pendencias.length} pendência(s) impedem a geração`}
              desc="Gerar sobre um plano incompleto produz uma escala que parece válida e não é. Resolva os pontos abaixo em Planos do mês."
              acoes={<Link href={`/planos?competencia=${competencia}`} className="esc-btn esc-btn-sm">Abrir planos do mês</Link>}
            >
              <ul className="divide-y max-h-72 overflow-auto" style={{ borderColor: 'var(--line)' }}>
                {pendencias.slice(0, 60).map((p, i) => (
                  <li key={i} className="px-4 py-2 text-[12px]">
                    <Link
                      href={`/planos?competencia=${competencia}&colab=${p.colaboradorId}`}
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
          )}

          {previa && (
            <Bloco
              titulo="Simulação"
              desc={`O motor rodaria agora ${aDefinir} alocação(ões) para ${ativos.length} pessoa(s). Nada foi gravado ainda — a escala só muda quando você confirmar.`}
            >
              <div className="px-4 py-3 grid gap-3 sm:grid-cols-3 border-b" style={{ borderColor: 'var(--line)' }}>
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--rose-bg)' }}>
                  <div className="esc-rotulo" style={{ color: 'var(--rose)' }}>Conflitos bloqueantes</div>
                  <div className="text-[22px] font-semibold esc-num" style={{ color: 'var(--rose)' }}>{previa.conflitos.length}</div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--amber-bg)' }}>
                  <div className="esc-rotulo" style={{ color: 'var(--amber)' }}>Alertas</div>
                  <div className="text-[22px] font-semibold esc-num" style={{ color: 'var(--amber)' }}>{previa.alertas.length}</div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--green-bg)' }}>
                  <div className="esc-rotulo" style={{ color: 'var(--green)' }}>Planos aderentes</div>
                  <div className="text-[22px] font-semibold esc-num" style={{ color: 'var(--green)' }}>
                    {aderentes}/{previa.aderencia.length}
                  </div>
                </div>
              </div>
              <ListaAvisos itens={[...previa.conflitos, ...previa.alertas]} />
            </Bloco>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Bloco
              titulo={geracao ? 'Regerar o mês inteiro' : 'Gerar a escala'}
              desc={
                geracao
                  ? `Cria a versão ${geracao.versao + 1}. As alocações travadas são preservadas; todo o resto é recalculado do zero.`
                  : 'Grava a primeira versão do mês como rascunho. Nada fica visível para os colaboradores até a publicação.'
              }
            >
              <form action={gerarEscalaDoMes} className="px-4 py-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="competencia" value={competencia} />
                <button type="submit" className="esc-btn" disabled={pendencias.length > 0}>
                  {geracao ? 'Regerar mês completo' : 'Gerar escala do mês'}
                </button>
                {pendencias.length > 0 && (
                  <span className="text-[11.5px]" style={{ color: 'var(--rose)' }}>
                    Resolva as pendências dos planos antes de gerar.
                  </span>
                )}
              </form>

              {ctx.pins.length > 0 && (
                <form action={liberarTodasAsTravas} className="px-4 pb-3 flex items-center gap-2">
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
              titulo="Regeração parcial"
              desc="Recalcula apenas o recorte escolhido. Tudo que ficar de fora é congelado exatamente como está na versão vigente."
            >
              {geracao ? (
                <form action={gerarEscalaDoMes} className="px-4 py-3 space-y-3">
                  <input type="hidden" name="competencia" value={competencia} />
                  <div>
                    <span className="esc-rotulo">Equipes (vazio = todas)</span>
                    <div className="flex flex-wrap gap-2">
                      {ctx.equipes.map(e => (
                        <label key={e.id} className="flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-md border cursor-pointer" style={{ borderColor: 'var(--line-2)' }}>
                          <input type="checkbox" name="equipes" value={e.id} />
                          {e.nome}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="block">
                      <span className="esc-rotulo">De</span>
                      <input type="date" name="de" className="esc-input w-40" />
                    </label>
                    <label className="block">
                      <span className="esc-rotulo">Até</span>
                      <input type="date" name="ate" className="esc-input w-40" />
                    </label>
                  </div>
                  <button type="submit" className="esc-btn esc-btn-outline" disabled={pendencias.length > 0}>
                    Regerar apenas o recorte
                  </button>
                </form>
              ) : (
                <p className="px-4 py-6 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  A regeração parcial fica disponível depois que existir uma versão gravada do mês.
                </p>
              )}
            </Bloco>
          </div>

          {geracao && (
            <Bloco
              titulo={`Versão vigente — ${formatarCompetencia(competencia)}`}
              desc={`Versão ${geracao.versao} · ${geracao.escopo} · gerada em ${formatarData(geracao.geradaEm.slice(0, 10))} por ${geracao.geradaPorNome}.`}
              acoes={
                <>
                  <Pill cor={STATUS_GERACAO[geracao.status].cor} bg={STATUS_GERACAO[geracao.status].bg}>
                    {STATUS_GERACAO[geracao.status].label}
                  </Pill>
                  <Link href={`/calendario?competencia=${competencia}`} className="esc-btn esc-btn-outline esc-btn-sm">
                    Revisar no calendário
                  </Link>
                  {geracao.status !== 'encerrada' && (
                    <form action={mudarStatusEscala}>
                      <input type="hidden" name="competencia" value={competencia} />
                      <input type="hidden" name="volta" value="/gerar" />
                      <input type="hidden" name="status" value={geracao.status === 'rascunho' ? 'publicada' : 'encerrada'} />
                      <button type="submit" className={`esc-btn esc-btn-sm ${geracao.status === 'rascunho' ? '' : 'esc-btn-outline'}`}>
                        {geracao.status === 'rascunho' ? 'Publicar para a equipe' : 'Encerrar o mês'}
                      </button>
                    </form>
                  )}
                </>
              }
            >
              {/* A edição manual existia desde sempre, mas ficava escondida atrás
                  de um clique num dia do calendário — ninguém adivinha. */}
              {geracao.status === 'rascunho' && (
                <div
                  className="px-4 py-3 border-b text-[12.5px] leading-relaxed"
                  style={{ borderColor: 'var(--line)', background: 'var(--brand-50)' }}
                >
                  <strong>Ainda é rascunho — os colaboradores não enxergam esta escala.</strong>{' '}
                  É a hora de ajustar à mão: em{' '}
                  <Link
                    href={`/calendario?competencia=${competencia}`}
                    className="font-semibold underline"
                    style={{ color: 'var(--brand-700)' }}
                  >
                    Revisar no calendário
                  </Link>{' '}
                  você abre qualquer dia e move uma pessoa para outra unidade ou modalidade. O ajuste fica{' '}
                  <strong>travado</strong>: sobrevive a uma nova geração e só sai se você destravar. Publique
                  quando estiver do jeito que precisa.
                </div>
              )}
              <ListaAvisos itens={[...geracao.conflitos, ...geracao.alertas]} limite={20} />
            </Bloco>
          )}

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
    </>
  );
}
