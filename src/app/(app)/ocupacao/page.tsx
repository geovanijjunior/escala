import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import { carregarContextoMes, getGeracaoAtual, listarAlocacoes } from '@/lib/data/escalas';
import { DIAS_ABREV, diaSemana, diasNoMes, formatarCompetencia, formatarData, iso } from '@/lib/domain/escalas/datas';
import { competenciaDaBusca, comFiltros, texto, type Busca } from '@/lib/pagina';
import { Aviso, BarraOcupacao, Badge, Bloco, Vazio } from '@/components/Ui';
import { SeletorMes } from '@/components/SeletorMes';
import { FiltrosAuto } from '@/components/FiltrosAuto';
import { ExportarCsv } from '@/components/ExportarCsv';

export default async function OcupacaoPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  // O Administrador da Área cuida de cadastro, não de escala. As telas de
  // operação ficam fora do alcance dele mesmo quando a RLS deixaria ler.
  if (sessao.papel === 'admin_local') redirect('/');

  // A RLS entrega a este colaborador só as próprias alocações, então a tela
  // mostraria toda unidade em 0/16 — número errado apresentado como fato.
  // Medido em Postgres: planejamento enxerga 2 alocações, gestor 1, colaborador 0.
  if (sessao.papel === 'colaborador') redirect('/minha-escala');

  const parcial = sessao.papel === 'gestor';
  const competencia = competenciaDaBusca(busca);

  const ctx = await carregarContextoMes(competencia, sessao.conta.id);
  const geracao = await getGeracaoAtual(competencia);
  const todasAlocacoes = geracao ? await listarAlocacoes(geracao.id) : [];

  // Filtro por equipe. O painel responde "quantas posições estão ocupadas", e
  // quem coordena uma equipe precisa da mesma pergunta recortada: quantas
  // POR EQUIPE. Sem isto era preciso exportar e contar fora.
  //
  // O recorte é aplicado às ALOCAÇÕES, não à capacidade: a unidade continua
  // tendo os mesmos lugares, o que muda é quantos daquela equipe estão neles.
  const equipeFiltro = Number(texto(busca, 'equipe')) || null;
  const daEquipe = new Set(
    ctx.colaboradores.filter(c => !equipeFiltro || c.equipeId === equipeFiltro).map(c => c.id),
  );
  const alocacoes = equipeFiltro
    ? todasAlocacoes.filter(a => daEquipe.has(a.colaboradorId))
    : todasAlocacoes;

  const { ano, mes } = ctx;
  const nDias = diasNoMes(ano, mes);
  const ativas = ctx.unidades.filter(u => u.ativa);
  const colabPorId = new Map(ctx.colaboradores.map(c => [c.id, c]));
  const equipePorId = new Map(ctx.equipes.map(e => [e.id, e]));

  const posicoes = (unidadeId: number, data: string, dow: number) => {
    const u = ativas.find(x => x.id === unidadeId);
    if (!u) return 0;
    const esp = ctx.capacidades.find(c => c.unidadeId === unidadeId && c.data === data);
    const sem = ctx.capacidades.find(c => c.unidadeId === unidadeId && c.dow === dow);
    const cfg = esp ?? sem ?? { total: u.capacidadeTotal, reservadas: u.capacidadeReservadas };
    return Math.max(0, cfg.total - cfg.reservadas);
  };

  const diaSelecionado = texto(busca, 'dia') || iso(ano, mes, 1);

  if (!geracao) {
    return (
      <>
        <Cabecalho competencia={competencia} parcial={parcial} equipes={ctx.equipes} busca={busca} equipeFiltro={equipeFiltro} />
        <Bloco>
          <Vazio
            titulo={`Sem escala gerada em ${formatarCompetencia(competencia)}`}
            desc="A ocupação por unidade é calculada a partir da escala do mês."
            acao={
              sessao.papel === 'planejamento'
                ? <Link href={`/gerar?competencia=${competencia}`} className="esc-btn">Ir para a geração</Link>
                : undefined
            }
          />
        </Bloco>
      </>
    );
  }

  const csv: string[][] = [
    ['Data', 'Colaborador', 'Matrícula', 'Equipe', 'Cargo', 'Modalidade', 'Entrada', 'Turno'],
    ...alocacoes
      .filter(a => a.modalidade !== 'DESCANSO')
      .map(a => {
        const c = colabPorId.get(a.colaboradorId);
        const u = a.unidadeId ? ativas.find(x => x.id === a.unidadeId) : null;
        return [
          formatarData(a.data), c?.nome ?? '', c?.matricula ?? '',
          equipePorId.get(c?.equipeId ?? -1)?.nome ?? '', c?.cargo ?? '',
          a.modalidade === 'UNIDADE' ? (u?.nome ?? 'Unidade') : a.modalidade,
          c?.entrada ?? '', c?.turno === 'N' ? 'Noturno' : 'Diurno',
        ];
      }),
  ];

  return (
    <>
      <Cabecalho competencia={competencia} parcial={parcial} equipes={ctx.equipes} busca={busca} equipeFiltro={equipeFiltro} />
      <Aviso erro={texto(busca, 'erro') || undefined} />

      <Bloco
        titulo="Ocupação por dia"
        desc="Barras proporcionais às posições operacionais (capacidade total menos as reservadas). Clique num dia para ver quem está onde."
        acoes={<ExportarCsv linhas={csv} nomeArquivo={`ocupacao-${competencia.slice(0, 7)}.csv`} rotulo="Exportar mês em CSV" />}
      >
        <div className="overflow-x-auto px-3 py-3">
          <div className="flex gap-1 w-max">
            {Array.from({ length: nDias }, (_, i) => {
              const d = i + 1;
              const data = iso(ano, mes, d);
              const dow = diaSemana(ano, mes, d);
              const total = alocacoes.filter(a => a.data === data && a.modalidade === 'UNIDADE').length;
              return (
                <Link
                  key={data}
                  href={`/ocupacao${comFiltros(busca, { dia: data })}`}
                  className="w-11 shrink-0 rounded-md border px-1 py-1.5 text-center"
                  style={{
                    borderColor: diaSelecionado === data ? 'var(--brand-600)' : 'var(--line)',
                    background: diaSelecionado === data ? 'var(--brand-50)' : 'var(--surface)',
                  }}
                >
                  <div className="text-[9px] uppercase" style={{ color: 'var(--faint)' }}>{DIAS_ABREV[dow]}</div>
                  <div className="text-[12px] font-semibold esc-num">{d}</div>
                  <div className="flex items-end justify-center gap-px h-7 mt-1">
                    {ativas.map(u => {
                      const n = alocacoes.filter(a => a.data === data && a.modalidade === 'UNIDADE' && a.unidadeId === u.id).length;
                      const cap = posicoes(u.id, data, dow);
                      const h = cap > 0 ? Math.max(2, Math.round((n / cap) * 28)) : 2;
                      return <span key={u.id} className="w-2 rounded-sm" style={{ height: h, background: n >= cap && cap > 0 ? 'var(--rose)' : u.cor }} />;
                    })}
                  </div>
                  <div className="text-[9.5px] esc-num mt-0.5" style={{ color: 'var(--muted)' }}>{total}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </Bloco>

      <div className="grid gap-4 lg:grid-cols-2">
        {ativas.map(u => {
          const dow = diaSemana(ano, mes, Number(diaSelecionado.slice(8)));
          const cap = posicoes(u.id, diaSelecionado, dow);
          const pessoas = alocacoes
            .filter(a => a.data === diaSelecionado && a.modalidade === 'UNIDADE' && a.unidadeId === u.id)
            .map(a => colabPorId.get(a.colaboradorId))
            .filter(Boolean)
            .sort((a, b) => a!.nome.localeCompare(b!.nome));

          return (
            <Bloco
              key={u.id}
              titulo={u.nome}
              desc={`${pessoas.length} de ${cap} posições ocupadas em ${formatarData(diaSelecionado)} · ${u.capacidadeReservadas} reservada(s)`}
              acoes={pessoas.length >= cap && cap > 0 ? <Badge cor="var(--rose)" bg="var(--rose-bg)">Lotado</Badge> : undefined}
            >
              <div className="px-4 pt-1 pb-2">
                <BarraOcupacao ocupado={pessoas.length} capacidade={cap} cor={u.cor} />
              </div>
              {pessoas.length === 0 ? (
                <p className="px-4 pb-4 text-[12px]" style={{ color: 'var(--muted)' }}>
                  Ninguém alocado nesta unidade no dia selecionado.
                </p>
              ) : (
                <ul className="divide-y max-h-72 overflow-auto" style={{ borderColor: 'var(--line)' }}>
                  {pessoas.map(c => (
                    <li key={c!.id} className="px-4 py-2 flex items-center justify-between gap-3 text-[12.5px]">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c!.nome}</div>
                        <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                          {c!.cargo} · {equipePorId.get(c!.equipeId)?.nome ?? '—'}
                        </div>
                      </div>
                      <span className="esc-num shrink-0" style={{ color: 'var(--muted)' }}>
                        {c!.entrada} · {c!.turno === 'N' ? 'Not.' : 'Diu.'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          );
        })}

        <Bloco titulo="Remoto e ausências" desc={`Distribuição fora das unidades físicas em ${formatarData(diaSelecionado)}.`}>
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {(['HOME', 'EXTERNO', 'EVENTO', 'TREINA', 'FERIAS', 'FOLGA', 'AFAST', 'FERIADO'] as const).map(m => {
              const n = alocacoes.filter(a => a.data === diaSelecionado && a.modalidade === m).length;
              if (n === 0) return null;
              return (
                <li key={m} className="px-4 py-2 flex items-center justify-between text-[12.5px]">
                  <span>{m}</span>
                  <span className="esc-num font-semibold">{n}</span>
                </li>
              );
            })}
          </ul>
        </Bloco>
      </div>
    </>
  );
}

/**
 * `parcial` marca o gestor: ele só enxerga a própria equipe, então os números
 * aqui são um recorte, não a ocupação real da unidade. Sem dizer isso, "Morumbi
 * 3/16" seria lido como sobra de lugar quando na verdade o prédio pode estar
 * cheio de gente de outras equipes.
 */
function Cabecalho({
  competencia, parcial, equipes, busca, equipeFiltro,
}: {
  competencia: string;
  parcial: boolean;
  equipes: { id: number; nome: string }[];
  busca: Busca;
  equipeFiltro: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">
          {parcial ? 'Sua equipe por unidade' : 'Painel de ocupação'}
        </h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {parcial
            ? `Quantas pessoas da sua equipe estão em cada unidade, dia a dia — ${formatarCompetencia(competencia)}. Não é a ocupação total: você não enxerga as outras equipes.`
            : `Quantas posições cada unidade tem ocupadas, dia a dia — ${formatarCompetencia(competencia)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {/* O gestor já enxerga só a própria equipe pela RLS — oferecer o filtro
            a ele seria um seletor de um item só.

            Escolher a equipe JÁ filtra: `FiltrosAuto` envia o formulário na
            troca do select, e o "Aplicar" sai de cena. Filtro que exige
            confirmar parece quebrado — a pessoa escolhe a equipe, a tela não
            muda, e ela vai procurar o que fez de errado antes de procurar o
            botão. O mesmo componente já governa os filtros de Parâmetros, do
            calendário e da revisão da escala; esta era a tela fora do padrão. */}
        {!parcial && equipes.length > 1 && (
          <form method="get" className="flex items-end gap-2">
            <FiltrosAuto />
            <input type="hidden" name="competencia" value={competencia} />
            {texto(busca, 'dia') && <input type="hidden" name="dia" value={texto(busca, 'dia')} />}
            <label className="block">
              <span className="esc-rotulo">Equipe</span>
              <select
                name="equipe"
                defaultValue={equipeFiltro ? String(equipeFiltro) : ''}
                className="esc-input w-44"
              >
                <option value="">Todas as equipes</option>
                {equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
            {/* Sem JavaScript o envio automático não acontece, e sem o botão a
                tela ficaria com um filtro que não filtra. */}
            <noscript>
              <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Aplicar</button>
            </noscript>
          </form>
        )}
        <SeletorMes competencia={competencia} />
      </div>
    </div>
  );
}
