import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao, podeEditarEscala } from '@/lib/sessao';
import {
  carregarContextoMes, colaboradoresDaEscala, getGeracaoAtual, listarAlocacoes,
  listarAlteracoesPendentes, listarOcorrencias, pendenciasDoMes,
} from '@/lib/data/escalas';
import { conferirAlocacoes } from '@/lib/domain/escalas/conferencia';
import { DIAS_ABREV, diaSemana, diasNoMes, formatarCompetencia, iso, partesIso } from '@/lib/domain/escalas/datas';
import { REGRAS_MOTOR, STATUS_GERACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, comFiltros, texto, type Busca } from '@/lib/pagina';
import { gerarEscalaDoMes, liberarTodasAsTravas, mudarStatusEscala } from '@/app/actions-geracao';
import { Aviso, Bloco, ListaAvisos, Pill, Stat, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { PassosDaEscala } from '@/components/PassosDaEscala';
import { RevisaoDoPlano } from '@/components/RevisaoDoPlano';
import { GradeDoMes } from '@/components/GradeDoMes';
import { DetalheDoDia } from '@/components/DetalheDoDia';
import { AjusteDoColaborador } from '@/components/AjusteDoColaborador';
import { AlteracoesPendentes } from '@/components/AlteracoesPendentes';

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
  //
  // Uma URL que carrega um DIA é sobre revisar, mesmo com a escala publicada:
  // é para onde as ações do painel de ajuste voltam. Sem esta linha, salvar um
  // ajuste num mês publicado devolvia a pessoa à etapa 4 — fora da grade, longe
  // da caixa de saída e sem o dia que ela estava mexendo.
  const dia = texto(busca, 'dia');
  const sugerida = !temEscala ? 'plano' : dia ? 'revisar' : publicada ? 'publicar' : 'revisar';
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
  const ocorrencias = geracao ? await listarOcorrencias(competencia, iso(ano, mes, nDias)) : [];

  // O que já mudou na escala publicada e a equipe ainda não recebeu. Vive aqui
  // porque é aqui que a mudança é feita — deixá-la só no calendário significaria
  // ajustar num lugar e comunicar em outro.
  const podeMexer = !!geracao && podeEditarEscala(sessao.papel, geracao.status);
  const pendentesDeAviso = geracao && podeMexer ? await listarAlteracoesPendentes(geracao.id) : [];

  // ── Recorte da grade na etapa 3 ───────────────────────────────
  // Com duzentas pessoas, a grade inteira não é uma tela: é um documento. O
  // filtro é o que a torna operável — quem vai mexer chega sabendo o nome, a
  // equipe ou a unidade, e não querendo percorrer tudo.
  const filtroNome = texto(busca, 'q').toLowerCase();
  const filtroEquipe = Number(texto(busca, 'equipe')) || null;
  const filtroUnidade = Number(texto(busca, 'unidade')) || null;
  const soComAviso = texto(busca, 'avisos') === '1';

  const citados = new Set(
    [...diagnostico.conflitos, ...diagnostico.alertas]
      .map(a => a.colaboradorId)
      .filter((id): id is number => typeof id === 'number'),
  );

  const naGrade = ativos.filter(c => {
    if (filtroNome && !`${c.nome} ${c.matricula}`.toLowerCase().includes(filtroNome)) return false;
    if (filtroEquipe && c.equipeId !== filtroEquipe) return false;
    if (filtroUnidade && !alocacoes.some(
      a => a.colaboradorId === c.id && a.modalidade === 'UNIDADE' && a.unidadeId === filtroUnidade,
    )) return false;
    if (soComAviso && !citados.has(c.id)) return false;
    return true;
  });

  // A pessoa cujo dia está aberto para ajuste. Vem da célula clicada na grade,
  // que agora carrega os dois: quem e quando.
  const colabId = Number(texto(busca, 'colab')) || null;
  const emAjuste = colabId ? ctx.colaboradores.find(c => c.id === colabId) ?? null : null;

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
          {pendentesDeAviso.length > 0 && (
            <AlteracoesPendentes
              volta="/gerar"
              itens={pendentesDeAviso}
              competencia={competencia}
              conflitos={diagnostico.conflitos.length}
              alertas={diagnostico.alertas.length}
            />
          )}
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


          <div
            className="esc-card px-4 py-3 text-[12.5px] leading-relaxed"
            style={{
              borderLeft: `3px solid ${geracao.status === 'rascunho' ? 'var(--brand-700)' : 'var(--amber)'}`,
              background: geracao.status === 'rascunho' ? 'var(--brand-50)' : 'var(--amber-bg)',
            }}
          >
            {geracao.status === 'rascunho' ? (
              <>
                <strong>Ainda é rascunho — os colaboradores não enxergam esta escala.</strong>{' '}
                Clique na célula da pessoa e do dia que quer mudar: abre um painel para trocar a
                unidade, tirar do dia ou escalar quem estava de folga. O ajuste fica{' '}
                <strong>travado</strong> e sobrevive a uma nova geração; os números acima se refazem a
                cada mudança.
              </>
            ) : geracao.status === 'publicada' ? (
              <>
                <strong>Escala publicada — e ainda ajustável.</strong> Clique na célula da pessoa e do
                dia para tirar alguém ou escalar quem estava de folga. A diferença é o que acontece
                depois: cada mudança entra numa <strong>caixa de saída</strong> no topo desta tela, e a
                equipe só é avisada quando você mandar — assim uma reorganização de dez movimentos vira
                um aviso, não dez.
              </>
            ) : (
              <>
                <strong>Mês encerrado.</strong> A escala fica como está; nenhum ajuste é aceito.
              </>
            )}
          </div>

          {/* Célula clicada: o ajuste daquela pessoa naquele dia. É a resposta
              a "onde a Maria está no dia 14" — a lista do dia inteiro responde
              outra pergunta, e continua a um clique daqui. */}
          {dia && emAjuste && (
            <AjusteDoColaborador
              colaborador={emAjuste}
              data={dia}
              competencia={competencia}
              alocacao={alocacoes.find(a => a.colaboradorId === emAjuste.id && a.data === dia) ?? null}
              doDia={alocacoes.filter(a => a.data === dia)}
              equipe={ctx.equipes.find(e => e.id === emAjuste.equipeId)}
              unidades={ctx.unidades}
              capacidades={ctx.capacidades}
              conflitos={diagnostico.conflitos.filter(c => c.data === dia)}
              alertas={diagnostico.alertas.filter(a => a.data === dia)}
              feriado={ctx.feriados[dia]}
              podeEditar={podeEditarEscala(sessao.papel, geracao.status)}
              fecharHref={`/gerar${comFiltros(busca, { dia: null, colab: null })}`}
              diaInteiroHref={`/gerar${comFiltros(busca, { colab: null })}`}
              volta="/gerar"
            />
          )}

          {dia && !emAjuste && (
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
            desc={
              naGrade.length === ativos.length
                ? `${ativos.length} pessoa(s). Clique em qualquer célula — a da pessoa e do dia que você quer mudar.`
                : `${naGrade.length} de ${ativos.length} pessoa(s) neste filtro. Clique numa célula para ajustar.`
            }
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
            {/* O atalho para ajustar alguém sem caçar a célula na grade. */}
            {podeEditarEscala(sessao.papel, geracao.status) && (
              <div
                className="px-4 py-3 border-b text-[12.5px] leading-relaxed"
                style={{ borderColor: 'var(--line)', background: 'var(--brand-50)' }}
              >
                {/* Um seletor de verdade, e não três rótulos com cara de botão.
                    A versão anterior desenhava "trocar", "remover" e "adicionar"
                    como pastilhas coloridas dentro de uma faixa destacada: pareciam
                    controles, não respondiam a clique nenhum, e mandavam procurar a
                    célula certa na grade. Aqui a pessoa e o dia são escolhidos
                    direto, que é como a decisão chega pronta — "a Maria no dia 14".
                    O destino (unidade, folga, home office) é escolhido no painel que
                    isto abre, porque depende de ver a lotação daquele dia. */}
                <form method="get" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="competencia" value={competencia} />
                  <input type="hidden" name="etapa" value="revisar" />
                  <label className="block">
                    <span className="esc-rotulo">Ajustar quem</span>
                    <select name="colab" defaultValue="" required className="esc-input w-60">
                      <option value="" disabled>Escolha a pessoa</option>
                      {[...ativos]
                        .sort((a, b) => a.nome.localeCompare(b.nome))
                        .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="esc-rotulo">Em que dia</span>
                    <select name="dia" defaultValue="" required className="esc-input w-44">
                      <option value="" disabled>Escolha o dia</option>
                      {Array.from({ length: nDias }, (_, i) => {
                        const data = iso(ano, mes, i + 1);
                        return (
                          <option key={data} value={data}>
                            {DIAS_ABREV[diaSemana(ano, mes, i + 1)]}, {i + 1}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button type="submit" className="esc-btn esc-btn-sm">Abrir para ajustar</button>
                </form>

                <p className="mt-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  No painel dá para <strong>trocar</strong> a unidade, <strong>remover</strong> do dia
                  (passando para folga) ou <strong>escalar</strong> quem estava de folga. Clicar direto
                  numa célula da grade abaixo faz o mesmo, já com a pessoa e o dia preenchidos.
                </p>
              </div>
            )}

            {/* Achar a pessoa é o primeiro passo de qualquer ajuste, e com
                duzentas linhas ele não pode ser rolar a grade. */}
            <form method="get" className="px-4 py-3 flex flex-wrap items-end gap-3 border-b" style={{ borderColor: 'var(--line)' }}>
              <input type="hidden" name="competencia" value={competencia} />
              <input type="hidden" name="etapa" value="revisar" />
              <label className="block">
                <span className="esc-rotulo">Buscar</span>
                <input name="q" defaultValue={texto(busca, 'q')} placeholder="Nome ou matrícula" className="esc-input w-52" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Equipe</span>
                <select name="equipe" defaultValue={texto(busca, 'equipe')} className="esc-input w-44">
                  <option value="">Todas</option>
                  {ctx.equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="esc-rotulo">Passa pela unidade</span>
                <select name="unidade" defaultValue={texto(busca, 'unidade')} className="esc-input w-44">
                  <option value="">Qualquer uma</option>
                  {ctx.unidades.filter(u => u.ativa).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] pb-1.5">
                <input type="checkbox" name="avisos" value="1" defaultChecked={soComAviso} />
                Só quem tem conflito ou alerta
              </label>
              <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Aplicar</button>
              {(filtroNome || filtroEquipe || filtroUnidade || soComAviso) && (
                <Link href={href('revisar')} className="esc-btn esc-btn-ghost esc-btn-sm">Limpar</Link>
              )}
            </form>

            <GradeDoMes
              editavel={podeEditarEscala(sessao.papel, geracao.status)}
              ano={ano}
              mes={mes}
              competencia={competencia}
              colaboradores={naGrade}
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
              baseHref={`/gerar${comFiltros(busca, { etapa: 'revisar', dia: null, colab: null })}`}
            />
          </Bloco>

          {(diagnostico.conflitos.length > 0 || diagnostico.alertas.length > 0) && (
            <details className="esc-card">
              <summary className="px-4 py-3 cursor-pointer text-[12.5px] font-semibold">
                O que o motor apontou — {diagnostico.conflitos.length} conflito(s) e{' '}
                {diagnostico.alertas.length} alerta(s)
                <span className="font-normal ml-2" style={{ color: 'var(--muted)' }}>
                  (clique para abrir)
                </span>
              </summary>
              <p className="px-4 pb-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Conflito quebra uma regra rígida; alerta é algo a olhar. Nenhum dos dois impede
                publicar — quem decide é você.
              </p>
              <ListaAvisos itens={[...diagnostico.conflitos, ...diagnostico.alertas]} limite={30} />
            </details>
          )}
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

          {geracao.status === 'publicada' && (
            <div
              className="esc-card px-4 py-3 flex flex-wrap items-center gap-3"
              style={{ borderLeft: '3px solid var(--brand-700)' }}
            >
              <span className="text-[12.5px]">
                <strong>Publicar não fecha o mês.</strong> Dá para remover alguém de um dia ou escalar
                quem estava de folga a qualquer momento — a equipe é avisada quando você confirmar.
              </span>
              <Link href={href('revisar')} className="esc-btn esc-btn-outline esc-btn-sm ml-auto">
                Ajustar a escala
              </Link>
            </div>
          )}

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
