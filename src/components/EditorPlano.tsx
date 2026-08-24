import Link from 'next/link';
import { addDias, diffDias, formatarCompetencia, formatarData } from '@/lib/domain/escalas/datas';
import { DEGRAUS_PCT, GRUPOS_AUSENCIA } from '@/lib/domain/escalas/constantes';
import { salvarPlano, salvarAusencia, removerAusencia } from '@/app/actions-planos';
import { Bloco } from './Ui';
import { DistribuicaoEPostos } from './DistribuicaoEPostos';
import { MotivoDependente } from './MotivoDependente';
import { UnidadesFixasEHomeOffice } from './UnidadesFixasEHomeOffice';
import type { Ausencia, Ciclo, Colaborador, PlanoMensal, Posto, Unidade } from '@/lib/domain/escalas/tipos';

interface Props {
  colaborador: Colaborador;
  plano: PlanoMensal | null;
  ausencias: Ausencia[];
  unidades: Unidade[];
  postos: Posto[];
  competencia: string;
  /**
   * Em que paridade esta pessoa entra NESTE mês, já virada quando o plano veio
   * herdado de um mês de 31 dias. É o que o motor vai usar, então é o que o
   * rádio precisa mostrar — não o valor cru gravado no mês de origem. Sem isso,
   * abrir e salvar sem mexer em nada congelaria a paridade errada.
   */
  cicloDoMes: Ciclo;
  pendencias: string[];
  fecharHref: string;
}

/**
 * Editor do plano mensal de uma pessoa.
 *
 * A distribuição percentual só aceita os degraus 0/25/50/75/100 — em dias
 * inteiros, valores como 33% não significam nada e só geram desvio de aderência
 * que ninguém consegue explicar depois.
 */
export function EditorPlano({
  colaborador: c, plano, ausencias, unidades, postos, competencia, cicloDoMes, pendencias, fecharHref,
}: Props) {
  const ho = plano?.homeOffice;
  const ferias = ausencias.find(a => a.tipo === 'FERIAS');
  const outras = ausencias.filter(a => a.tipo === 'AUSENCIA');

  return (
    <div id="editor-plano" className="scroll-mt-16">
    <Bloco
      titulo={`Plano de ${c.nome} — ${formatarCompetencia(competencia)}`}
      desc={`${c.cargo} · ${c.regime} · turno ${c.turno === 'N' ? 'noturno' : 'diurno'} · entrada ${c.entrada} · unidade base ${unidades.find(u => u.id === c.unidadeBaseId)?.nome ?? '—'}`}
      acoes={<Link href={fecharHref} className="esc-btn esc-btn-ghost esc-btn-sm">Fechar</Link>}
    >
      {pendencias.length > 0 && (
        <ul className="px-4 py-2.5 space-y-1 border-b" style={{ borderColor: 'var(--line)', background: 'var(--rose-bg)' }}>
          {pendencias.map((p, i) => (
            <li key={i} className="text-[11.5px] font-medium" style={{ color: 'var(--rose)' }}>{p}</li>
          ))}
        </ul>
      )}

      {/* Sem esta faixa, um plano herdado se parece com um plano conferido, e
          quem abre a tela não sabe se está olhando uma decisão deste mês ou a
          repetição de uma decisão de três meses atrás. */}
      {plano?.herdadoDe && (
        <p
          className="px-4 py-2.5 text-[11.5px] border-b"
          style={{ borderColor: 'var(--line)', background: 'var(--amber-bg)', color: 'var(--amber)' }}
        >
          <strong className="font-semibold">Herdado de {formatarCompetencia(plano.herdadoDe)}.</strong>{' '}
          As regras abaixo continuam valendo porque ninguém as mudou. Salvar fixa uma cópia
          neste mês; a partir daí, editar {formatarCompetencia(plano.herdadoDe)} não mexe mais aqui.
          Férias e ausências nunca são herdadas — vêm das solicitações aprovadas.
        </p>
      )}

      <form action={salvarPlano} className="px-4 py-4 space-y-5">
        <input type="hidden" name="competencia" value={competencia} />
        <input type="hidden" name="colaboradorId" value={c.id} />

        {c.regime === '12x36' && (
          <section>
            <span className="esc-rotulo">Ciclo do mês (12x36)</span>
            <div className="flex gap-2">
              {(['IMPAR', 'PAR'] as const).map(v => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-[12.5px]"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <input type="radio" name="ciclo" value={v} defaultChecked={cicloDoMes === v} required />
                  Dias {v === 'IMPAR' ? 'ímpares' : 'pares'}
                </label>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
              {plano?.herdadoDe ? (
                <>
                  Meses de 31 dias invertem a paridade no mês seguinte, para preservar o descanso de 36h.
                  A opção acima já vem virada a partir de {formatarCompetencia(plano.herdadoDe)} — é a
                  paridade que o motor vai usar neste mês. Se a operação combinou outra, troque aqui.
                </>
              ) : (
                <>
                  Meses de 31 dias invertem a paridade no mês seguinte, para preservar o descanso de 36h.
                  Nos meses em que ninguém revisar este plano, a virada é aplicada sozinha.
                </>
              )}
            </p>
          </section>
        )}

        <DistribuicaoEPostos
          unidades={unidades}
          valores={Object.fromEntries(unidades.map(u => [u.id, plano?.distribuicao[u.id] ?? (u.id === c.unidadeBaseId ? 100 : 0)]))}
          degraus={DEGRAUS_PCT}
          postos={postos}
          atribuidos={plano?.postos ?? []}
        />

        <UnidadesFixasEHomeOffice
          unidades={unidades}
          unidadesFixas={plano?.unidadesFixas ?? {}}
          homeOffice={ho ?? { modo: null, diasSemana: [], quantidade: 2, diasPreferencia: [], diasProibidos: [] }}
          elegHome={c.elegHome}
          nome={c.nome}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="submit" className="esc-btn">Salvar plano</button>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Salvar o plano não altera a escala já gerada — é preciso gerar de novo.
          </span>
        </div>
      </form>

      <div className="border-t px-4 py-4 space-y-4" style={{ borderColor: 'var(--line)' }}>
        {/* Férias, só como informação.
            Elas deixaram de ser lançadas aqui: agora entram por solicitação
            aprovada, e a aprovação já grava a ausência e trava os dias na
            escala. Ter um segundo lugar para criá-las produzia férias que
            existiam no plano sem nenhuma decisão por trás — e apagáveis por um
            botão que não desfazia a solicitação correspondente.

            Mostrar continua valendo: quem monta o mês precisa ver quem está
            fora, e era essa a parte útil deste bloco. */}
        <div id="ausencias" className="scroll-mt-24">
          <span className="esc-rotulo">Férias</span>
          {ferias ? (
            <p className="text-[12.5px]">
              {formatarData(ferias.inicio)} a {formatarData(addDias(ferias.inicio, ferias.dias - 1))}{' '}
              <span style={{ color: 'var(--muted)' }}>({ferias.dias} dias corridos)</span>
            </p>
          ) : (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              Sem férias neste período.
            </p>
          )}
          <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
            Férias vêm de solicitação aprovada — em Solicitações. A aprovação já marca os dias na escala.
          </p>
        </div>

        <div>
          <span className="esc-rotulo">Ausências (folga, licença, atestado)</span>
          {outras.length > 0 && (
            <ul className="mb-2 space-y-1">
              {outras.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span>
                    <strong className="font-semibold">{a.grupo}</strong> — {a.motivo} ·{' '}
                    {formatarData(a.inicio)} a {formatarData(addDias(a.inicio, a.dias - 1))}
                    <span style={{ color: 'var(--muted)' }}> ({a.dias} dia(s))</span>
                  </span>
                  <form action={removerAusencia}>
                    <input type="hidden" name="competencia" value={competencia} />
                    <input type="hidden" name="colaboradorId" value={c.id} />
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">Remover</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={salvarAusencia} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="colaboradorId" value={c.id} />
            <input type="hidden" name="tipo" value="AUSENCIA" />
            <label className="block">
              <span className="esc-rotulo">Início</span>
              <input type="date" name="inicio" required className="esc-input w-40" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Fim</span>
              <input type="date" name="fim" className="esc-input w-40" />
              <span className="esc-ajuda mt-1 block">Vazio = só o dia de início.</span>
            </label>
            <MotivoDependente grupos={GRUPOS_AUSENCIA} />
            <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Adicionar ausência</button>
          </form>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
            A ausência fica ligada à pessoa, não ao mês: um período que começa em um mês e termina no seguinte
            bloqueia os dois. Períodos sobrepostos são recusados na gravação.
          </p>
        </div>
      </div>
    </Bloco>
    </div>
  );
}

/** Usado pelo resumo do plano para exibir a janela calculada de uma ausência. */
export function janela(inicio: string, dias: number): string {
  return `${formatarData(inicio)} a ${formatarData(addDias(inicio, dias - 1))} (${diffDias(inicio, addDias(inicio, dias - 1)) + 1} dias)`;
}
