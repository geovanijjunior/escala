import Link from 'next/link';
import { getSessao } from '@/lib/sessao';
import {
  carregarContextoMes, getGeracaoAtual, listarAlocacoes, listarSolicitacoes, listarUnidades,
} from '@/lib/data/escalas';
import {
  DIAS_ABREV, diaSemana, diasNoMes, formatarCompetencia, formatarData, iso, somaHoras,
} from '@/lib/domain/escalas/datas';
import { STATUS_SOLICITACAO, TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, texto, type Busca } from '@/lib/pagina';
import { abrirSolicitacao } from '@/app/actions-solicitacoes';
import { Aviso, Badge, Bloco, Pill, Vazio, aparencia } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { NovaSolicitacao } from '@/components/NovaSolicitacao';

export default async function MinhaEscalaPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  const competencia = competenciaDaBusca(busca);

  if (!sessao.colaboradorId) {
    return (
      <Bloco>
        <Vazio
          titulo="Seu usuário não está vinculado a um colaborador"
          desc="A escala é montada por colaborador. Peça ao Planejamento para vincular o seu login ao seu cadastro em Colaboradores."
        />
      </Bloco>
    );
  }

  const [ctx, geracao, unidades, solicitacoes] = await Promise.all([
    carregarContextoMes(competencia, sessao.conta.id),
    getGeracaoAtual(competencia),
    listarUnidades(),
    listarSolicitacoes(),
  ]);

  const eu = ctx.colaboradores.find(c => c.id === sessao.colaboradorId);
  const alocacoes = geracao ? await listarAlocacoes(geracao.id) : [];
  const minhas = alocacoes.filter(a => a.colaboradorId === sessao.colaboradorId);
  const porData = new Map(minhas.map(a => [a.data, a]));

  const { ano, mes } = ctx;
  const nDias = diasNoMes(ano, mes);
  const hoje = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const proximos = minhas
    .filter(a => a.data >= hoje && a.modalidade !== 'DESCANSO')
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 4);

  const faixa = (dow: number) => {
    if (!eu) return '';
    const horas = eu.sextaReduzida && dow === 5 ? eu.jornada - 1 : eu.jornada;
    return `${eu.entrada}–${somaHoras(eu.entrada, horas + (horas > 6 ? 1 : 0))}`;
  };

  // Só entram trocas com quem está no mesmo regime e na mesma equipe — o motor
  // não conseguiria honrar uma troca entre 12x36 e 5x2.
  const colegas = eu
    ? ctx.colaboradores.filter(c => c.id !== eu.id && c.status === 'ativo' && c.regime === eu.regime && c.equipeId === eu.equipeId)
    : [];

  const minhasSolicitacoes = solicitacoes.filter(
    s => s.colaboradorId === sessao.colaboradorId || s.parceiroId === sessao.colaboradorId
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Minha escala</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {eu?.nome} · {eu?.cargo} · {formatarCompetencia(competencia)}
          </p>
        </div>
        <SeletorMes competencia={competencia} />
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      {!geracao ? (
        <Bloco>
          <Vazio
            titulo={`A escala de ${formatarCompetencia(competencia)} ainda não foi publicada`}
            desc="Assim que o Planejamento publicar, seus dias aparecem aqui. Você continua podendo abrir solicitações abaixo."
          />
        </Bloco>
      ) : (
        <>
          {geracao.status === 'rascunho' && (
            <div
              className="esc-card px-4 py-2.5 text-[12.5px] font-medium"
              style={{ borderLeft: '3px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber)' }}
            >
              Esta escala ainda está em rascunho — as datas podem mudar até a publicação.
            </div>
          )}

          {proximos.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {proximos.map(a => {
                const ap = aparencia(a.modalidade, a.unidadeId, unidades);
                const dow = diaSemana(ano, mes, Number(a.data.slice(8)));
                const ausente = ['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade);
                return (
                  <div key={a.data} className="esc-card px-4 py-3" style={{ borderLeft: `3px solid ${ap.cor}` }}>
                    <div className="esc-rotulo mb-1">{DIAS_ABREV[dow]}, {formatarData(a.data)}</div>
                    <div className="text-[15px] font-semibold" style={{ color: ap.cor }}>{ap.label}</div>
                    {!ausente && <div className="text-[12px] esc-num mt-0.5" style={{ color: 'var(--muted)' }}>{faixa(dow)}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <Bloco titulo={`Calendário de ${formatarCompetencia(competencia)}`}>
            <div className="p-3 sm:p-4">
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {DIAS_ABREV.map(d => (
                  <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--faint)' }}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: diaSemana(ano, mes, 1) }, (_, i) => <div key={`v${i}`} />)}
                {Array.from({ length: nDias }, (_, i) => {
                  const d = i + 1;
                  const data = iso(ano, mes, d);
                  const a = porData.get(data);
                  const ap = a ? aparencia(a.modalidade, a.unidadeId, unidades) : null;
                  const trabalha = a && !['DESCANSO', 'FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(a.modalidade);
                  return (
                    <div
                      key={data}
                      className="rounded-lg border p-1.5 min-h-[70px] flex flex-col"
                      style={{
                        background: ap && a?.modalidade !== 'DESCANSO' ? ap.bg : 'var(--bg)',
                        borderColor: data === hoje ? 'var(--brand-600)' : 'var(--line)',
                        borderWidth: data === hoje ? 2 : 1,
                      }}
                    >
                      <span className="text-[12px] font-semibold esc-num" style={{ color: ap && a?.modalidade !== 'DESCANSO' ? ap.cor : 'var(--faint)' }}>
                        {d}
                      </span>
                      {a && a.modalidade !== 'DESCANSO' && (
                        <>
                          <span className="text-[10px] font-semibold mt-auto" style={{ color: ap!.cor }}>{ap!.sigla}</span>
                          {trabalha && <span className="text-[9px] esc-num" style={{ color: ap!.cor }}>{eu?.entrada}</span>}
                        </>
                      )}
                      {ctx.feriados[data] && (
                        <span className="text-[8.5px] leading-tight truncate mt-auto" title={ctx.feriados[data]} style={{ color: 'var(--amber)' }}>
                          {ctx.feriados[data]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
                {unidades.filter(u => u.ativa).map(u => (
                  <Badge key={u.id} cor={u.cor} bg={u.bg}>{u.sigla} · {u.nome}</Badge>
                ))}
                <Badge cor="#6D28D9" bg="#EDE9FE">HO · Home Office</Badge>
                <Badge cor="#B45309" bg="#FEF3C7">FÉR · Férias</Badge>
                <Badge cor="#526176" bg="#F1F5F9">AUS · Ausência</Badge>
              </div>
            </div>
          </Bloco>
        </>
      )}

      <Bloco
        titulo="Abrir solicitação"
        desc="Troca de plantão precisa do aceite do colega, depois passa pela triagem do Planejamento e só então vai ao gestor."
      >
        <form action={abrirSolicitacao} className="px-4 py-4">
          <input type="hidden" name="volta" value="/minha-escala" />
          <NovaSolicitacao
            colegas={colegas.map(c => ({ id: c.id, nome: c.nome }))}
            unidades={unidades.filter(u => u.ativa).map(u => ({ id: u.id, nome: u.nome }))}
            tipos={Object.entries(TIPOS_SOLICITACAO).map(([k, v]) => ({ chave: k, label: v.label, sla: v.sla }))}
          />
        </form>
      </Bloco>

      <Bloco titulo={`Minhas solicitações (${minhasSolicitacoes.length})`}>
        {minhasSolicitacoes.length === 0 ? (
          <Vazio titulo="Nenhuma solicitação" desc="Os pedidos que você abrir e as trocas em que for convidado aparecem aqui." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {minhasSolicitacoes.map(s => {
              const cfg = STATUS_SOLICITACAO[s.status];
              const aguardaMim = s.parceiroId === sessao.colaboradorId && s.status === 'AGUARDA_PARCEIRO';
              return (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{TIPOS_SOLICITACAO[s.tipo].label}</span>
                    <span className="text-[12px] esc-num" style={{ color: 'var(--muted)' }}>{formatarData(s.data)}</span>
                    {s.posicaoFila && <Badge cor="var(--brand-700)" bg="var(--brand-100)">{s.posicaoFila}º na fila</Badge>}
                    {aguardaMim && <Badge cor="var(--amber)" bg="var(--amber-bg)">Aguarda sua resposta</Badge>}
                    <span className="ml-auto"><Pill cor={cfg.cor} bg={cfg.bg}>{cfg.label}</Pill></span>
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>{s.detalhe}</p>
                  {s.motivoRecusa && (
                    <p className="text-[11.5px] mt-1.5 rounded px-2 py-1" style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}>
                      Motivo da recusa: {s.motivoRecusa}
                    </p>
                  )}
                  {aguardaMim && (
                    <Link href="/solicitacoes" className="esc-btn esc-btn-sm mt-2">Responder à troca</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Bloco>
    </>
  );
}
