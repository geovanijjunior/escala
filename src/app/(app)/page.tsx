import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import {
  carregarContextoMes, getGeracaoAtual, listarAlocacoes, listarOcorrencias, listarSolicitacoes,
} from '@/lib/data/escalas';
import { diaSemana, diasNoMes, formatarCompetencia, iso } from '@/lib/domain/escalas/datas';
import { STATUS_ABERTOS, TIPOS_OCORRENCIA, TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { competenciaDaBusca, texto, type Busca } from '@/lib/pagina';
import { Aviso, BarraOcupacao, Bloco, ListaAvisos, Stat, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';

export default async function IndicadoresPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel === 'colaborador') redirect('/minha-escala');

  const competencia = competenciaDaBusca(busca);
  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const geracao = await getGeracaoAtual(competencia);
  const { ano, mes } = ctx;
  const nDias = diasNoMes(ano, mes);

  const [alocacoes, ocorrencias, solicitacoes] = await Promise.all([
    geracao ? listarAlocacoes(geracao.id) : Promise.resolve([]),
    listarOcorrencias(competencia, iso(ano, mes, nDias)),
    listarSolicitacoes(),
  ]);

  const colabPorId = new Map(ctx.colaboradores.map(c => [c.id, c]));
  const ativas = ctx.unidades.filter(u => u.ativa);

  const escalados = alocacoes.filter(a => !['DESCANSO', 'FERIADO'].includes(a.modalidade)).length;
  const faltas = ocorrencias.filter(o => o.tipo === 'FALTA_I' || o.tipo === 'FALTA_J').length;
  const atrasos = ocorrencias.filter(o => o.tipo === 'ATRASO');
  const minutosAtraso = atrasos.reduce((acc, o) => acc + o.minutos, 0);
  const absenteismo = escalados > 0 ? (faltas / escalados) * 100 : 0;
  const aderentes = geracao?.aderencia.filter(a => a.ok).length ?? 0;
  const totalAderencia = geracao?.aderencia.length ?? 0;
  const abertas = solicitacoes.filter(s => STATUS_ABERTOS.includes(s.status));

  // Média só sobre dias úteis: incluir fim de semana rebaixaria a ocupação de
  // uma operação 5x2 sem que nada de fato tenha mudado.
  const diasUteis = Array.from({ length: nDias }, (_, i) => i + 1).filter(d => ![0, 6].includes(diaSemana(ano, mes, d)));
  const mediaPorUnidade = ativas.map(u => {
    const soma = diasUteis.reduce((acc, d) => {
      const data = iso(ano, mes, d);
      return acc + alocacoes.filter(a => a.data === data && a.modalidade === 'UNIDADE' && a.unidadeId === u.id).length;
    }, 0);
    const media = diasUteis.length ? soma / diasUteis.length : 0;
    const cap = Math.max(0, u.capacidadeTotal - u.capacidadeReservadas);
    return { u, media, cap, pct: cap > 0 ? (media / cap) * 100 : 0 };
  });

  const rankingAtrasos = [...new Map(
    atrasos.reduce((mapa, o) => {
      const atual = mapa.get(o.colaboradorId) ?? { nome: o.colaboradorNome, n: 0, min: 0 };
      mapa.set(o.colaboradorId, { nome: atual.nome, n: atual.n + 1, min: atual.min + o.minutos });
      return mapa;
    }, new Map<number, { nome: string; n: number; min: number }>())
  ).values()].sort((a, b) => b.min - a.min).slice(0, 6);

  const homePorColab = [...alocacoes
    .filter(a => a.modalidade === 'HOME')
    .reduce((mapa, a) => mapa.set(a.colaboradorId, (mapa.get(a.colaboradorId) ?? 0) + 1), new Map<number, number>())
    .entries()]
    .map(([id, n]) => ({ nome: colabPorId.get(id)?.nome ?? '—', n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const porTipo = Object.entries(
    solicitacoes.reduce((mapa, s) => ({ ...mapa, [s.tipo]: (mapa[s.tipo] ?? 0) + 1 }), {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);
  const maiorTipo = porTipo[0]?.[1] ?? 1;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Indicadores operacionais</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {sessao.papel === 'gestor' ? 'Recorte da sua equipe' : 'Visão consolidada'} · {formatarCompetencia(competencia)}
          </p>
        </div>
        <SeletorMes competencia={competencia} />
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} />

      {!geracao ? (
        <Bloco>
          <Vazio
            titulo={`Nenhuma escala gerada para ${formatarCompetencia(competencia)}`}
            desc="Os indicadores são calculados sobre a escala do mês. Gere a escala para vê-los aqui."
            acao={
              sessao.papel === 'planejamento'
                ? <Link href={`/gerar?competencia=${competencia}`} className="esc-btn">Ir para a geração</Link>
                : undefined
            }
          />
        </Bloco>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Absenteísmo"
              valor={`${absenteismo.toFixed(1)}%`}
              sub={`${faltas} falta(s) em ${escalados} dia(s) escalados`}
              cor="var(--rose)"
              alerta={absenteismo > 3}
            />
            <Stat label="Atrasos" valor={atrasos.length} sub={`${minutosAtraso} minutos acumulados`} cor="var(--amber)" alerta={atrasos.length > 0} />
            <Stat
              label="Aderência ao plano"
              valor={totalAderencia ? `${Math.round((aderentes / totalAderencia) * 100)}%` : '—'}
              sub={`${aderentes} de ${totalAderencia} dentro da tolerância ±${ctx.config.toleranciaAderencia}`}
            />
            <Stat label="Solicitações abertas" valor={abertas.length} sub={`${solicitacoes.length} no total do período`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Bloco titulo="Ocupação média por unidade" desc="Média nos dias úteis do mês, sobre as posições operacionais.">
              <ul className="px-4 py-3 space-y-3">
                {mediaPorUnidade.map(({ u, media, cap, pct }) => (
                  <li key={u.id}>
                    <div className="flex items-baseline justify-between text-[12.5px] mb-1">
                      <span className="font-medium" style={{ color: u.cor }}>{u.nome}</span>
                      <span className="esc-num" style={{ color: 'var(--muted)' }}>
                        {media.toFixed(1)} de {cap} · {Math.round(pct)}%
                      </span>
                    </div>
                    <BarraOcupacao ocupado={media} capacidade={cap} cor={u.cor} />
                  </li>
                ))}
              </ul>
            </Bloco>

            <Bloco titulo="Ranking de atrasos" desc="Minutos acumulados no mês, por colaborador.">
              {rankingAtrasos.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Nenhum atraso registrado neste mês.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {rankingAtrasos.map(r => (
                    <li key={r.nome} className="px-4 py-2 flex items-center justify-between text-[12.5px]">
                      <span className="font-medium">{r.nome}</span>
                      <span className="esc-num" style={{ color: 'var(--amber)' }}>
                        {r.min} min · {r.n}x
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>

            <Bloco titulo="Solicitações por tipo" desc="Volume no período, independentemente do status.">
              {porTipo.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Nenhuma solicitação registrada.
                </p>
              ) : (
                <ul className="px-4 py-3 space-y-2">
                  {porTipo.map(([tipo, n]) => (
                    <li key={tipo}>
                      <div className="flex items-baseline justify-between text-[12px] mb-0.5">
                        <span>{TIPOS_SOLICITACAO[tipo as keyof typeof TIPOS_SOLICITACAO]?.label ?? tipo}</span>
                        <span className="esc-num font-semibold">{n}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: 'var(--line)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(n / maiorTipo) * 100}%`, background: 'var(--brand-600)' }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>

            <Bloco titulo="Home office realizado" desc="Dias de home office efetivamente escalados no mês.">
              {homePorColab.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Nenhum dia de home office nesta escala.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {homePorColab.map(h => (
                    <li key={h.nome} className="px-4 py-2 flex items-center justify-between text-[12.5px]">
                      <span className="font-medium">{h.nome}</span>
                      <span className="esc-num" style={{ color: '#6D28D9' }}>{h.n} dia(s)</span>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          </div>

          {(geracao.conflitos.length > 0 || geracao.alertas.length > 0) && (
            <Bloco
              titulo="Conflitos e alertas da escala vigente"
              desc="Registrados no momento da geração. Bloqueantes exigem decisão manual; avisos são desvios tolerados."
            >
              <ListaAvisos itens={[...geracao.conflitos, ...geracao.alertas]} limite={30} />
            </Bloco>
          )}

          {ocorrencias.length > 0 && (
            <Bloco titulo="Ocorrências do mês" desc="Lançamentos de ponto e intercorrências registrados pelo Planejamento e pelos gestores.">
              <div className="overflow-x-auto max-h-96">
                <table className="esc-tabela">
                  <thead className="sticky top-0">
                    <tr>
                      <th>Data</th>
                      <th>Colaborador</th>
                      <th>Tipo</th>
                      <th className="text-right">Minutos</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocorrencias.map(o => (
                      <tr key={o.id}>
                        <td className="esc-num">{o.data.split('-').reverse().join('/')}</td>
                        <td className="font-medium">{o.colaboradorNome}</td>
                        <td style={{ color: TIPOS_OCORRENCIA[o.tipo].cor }}>{TIPOS_OCORRENCIA[o.tipo].label}</td>
                        <td className="text-right esc-num">{o.minutos || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{o.obs || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bloco>
          )}
        </>
      )}
    </>
  );
}
