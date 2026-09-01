import Link from 'next/link';
import { DIAS_ABREV, dowDeIso, fimDoTurno, formatarData } from '@/lib/domain/escalas/datas';
import { MODALIDADES } from '@/lib/domain/escalas/constantes';
import { capacidadeOperacional } from '@/lib/domain/escalas/conferencia';
import { alternarTrava, reposicionarAlocacao } from '@/app/actions-geracao';
import { Badge, Bloco, aparencia } from './Ui';
import type {
  Alocacao, Aviso, CapacidadeOverride, Colaborador, Equipe, Unidade,
} from '@/lib/domain/escalas/tipos';

interface Props {
  colaborador: Colaborador;
  data: string;
  competencia: string;
  /** A alocação desta pessoa neste dia, quando existe. */
  alocacao: Alocacao | null;
  /** Todas as alocações do dia — para contar a lotação de cada unidade. */
  doDia: Alocacao[];
  equipe: Equipe | undefined;
  unidades: Unidade[];
  capacidades: CapacidadeOverride[];
  conflitos: Aviso[];
  alertas: Aviso[];
  feriado?: string;
  podeEditar: boolean;
  fecharHref: string;
  /** Para ver o dia inteiro, quando a pergunta deixa de ser sobre esta pessoa. */
  diaInteiroHref: string;
  volta: string;
}

/**
 * Ajuste de UMA pessoa em UM dia.
 *
 * O painel do dia responde "quem está no dia 14"; esta tela responde "onde a
 * Maria está no dia 14", que é a pergunta de quem vai mexer. Com duzentas
 * pessoas na escala, as duas perguntas deixam de ser a mesma coisa: achar
 * alguém dentro de uma lista de duzentos nomes para trocar uma célula é
 * trabalho manual que a tela deveria ter poupado.
 *
 * A entrada é a própria grade — cada célula (pessoa × dia) abre aqui, inclusive
 * a de quem está de folga. Antes a célula levava só a data, e a pessoa clicada
 * se perdia no caminho; folga não era clicável, então incluir alguém num dia
 * não tinha entrada nenhuma pela grade.
 *
 * O contexto de decisão vem junto — a lotação de cada unidade naquele dia e o
 * que a conferência apontou — porque mover alguém sem ver quanto lugar sobrou é
 * como o estouro de capacidade acontece.
 */
export function AjusteDoColaborador({
  colaborador: c, data, competencia, alocacao, doDia, equipe, unidades, capacidades,
  conflitos, alertas, feriado, podeEditar, fecharHref, diaInteiroHref, volta,
}: Props) {
  const dow = dowDeIso(data);
  const ativas = unidades.filter(u => u.ativa);
  const atual = alocacao ? aparencia(alocacao.modalidade, alocacao.unidadeId, unidades) : null;
  const ausente = !!alocacao && ['FERIAS', 'FOLGA', 'AFAST', 'FERIADO'].includes(alocacao.modalidade);

  // Os conflitos que citam esta pessoa vêm primeiro: são os que explicam o que
  // ela está fazendo aqui. O resto do dia fica logo abaixo, porque mover alguém
  // para uma unidade lotada é conflito de outra pessoa até o instante seguinte.
  const meus = [...conflitos, ...alertas].filter(a => a.colaboradorId === c.id);
  const doResto = [...conflitos, ...alertas].filter(a => a.colaboradorId !== c.id);

  const lotacao = ativas.map(u => ({
    unidade: u,
    dentro: doDia.filter(a => a.modalidade === 'UNIDADE' && a.unidadeId === u.id).length,
    lugares: capacidadeOperacional(u, data, dow, capacidades),
  }));

  return (
    <Bloco
      // Alvo da célula da grade. A grade fica DEPOIS deste bloco na página, e
      // sem âncora o clique numa célula lá embaixo devolvia a pessoa ao topo —
      // com o painel que ela abriu em algum ponto do meio, fora da vista.
      id="ajuste-do-dia"
      titulo={`${c.nome} — ${DIAS_ABREV[dow]}, ${formatarData(data)}${feriado ? ` · ${feriado}` : ''}`}
      desc={`${c.cargo} · ${equipe?.nome ?? 'sem equipe'} · ${c.regime} · ${c.entrada}–${fimDoTurno(c.saida, c.sextaReduzida, dow)}`}
      acoes={
        <>
          <Link href={diaInteiroHref} className="esc-btn esc-btn-outline esc-btn-sm">
            Ver o dia inteiro
          </Link>
          <Link href={fecharHref} className="esc-btn esc-btn-ghost esc-btn-sm">Fechar</Link>
        </>
      }
    >
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b" style={{ borderColor: 'var(--line)' }}>
        <span className="esc-rotulo">Hoje está como</span>
        {atual ? (
          <Badge cor={atual.cor} bg={atual.bg}>{atual.label}</Badge>
        ) : (
          <Badge cor="var(--muted)" bg="var(--bg)">Sem alocação neste dia</Badge>
        )}
        {alocacao?.travado && <Badge cor="var(--brand-700)" bg="var(--brand-100)">travado</Badge>}
      </div>

      {(meus.length > 0 || doResto.length > 0) && (
        <div className="px-4 py-2.5 border-b space-y-1" style={{ borderColor: 'var(--line)' }}>
          {meus.map((a, i) => (
            <p key={`m${i}`} className="text-[11.5px] font-medium" style={{ color: a.nivel === 'erro' ? 'var(--rose)' : 'var(--amber)' }}>
              {a.msg}
            </p>
          ))}
          {doResto.slice(0, 4).map((a, i) => (
            <p key={`o${i}`} className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {a.colaborador ? `${a.colaborador}: ` : ''}{a.msg}
            </p>
          ))}
        </div>
      )}

      {/* A lotação de cada unidade NAQUELE dia, ao lado do seletor que vai mudá-la. */}
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b" style={{ borderColor: 'var(--line)' }}>
        {lotacao.map(({ unidade: u, dentro, lugares }) => {
          const estourou = dentro > lugares;
          const cheia = dentro === lugares;
          return (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]"
              style={{ borderColor: estourou ? 'var(--rose)' : 'var(--line-2)' }}
            >
              <span className="font-semibold" style={{ color: u.cor }}>{u.sigla}</span>
              <span className="esc-num" style={{ color: estourou ? 'var(--rose)' : 'var(--muted)' }}>
                {dentro} de {lugares}
              </span>
              {estourou && <Badge cor="var(--rose)" bg="var(--rose-bg)">estourou</Badge>}
              {cheia && !estourou && <Badge cor="var(--amber)" bg="var(--amber-bg)">lotada</Badge>}
            </span>
          );
        })}
      </div>

      {podeEditar ? (
        <div className="px-4 py-4 space-y-3">
          <form action={reposicionarAlocacao} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="colaboradorId" value={c.id} />
            <input type="hidden" name="data" value={data} />
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="volta" value={volta} />
            <label className="block">
              <span className="esc-rotulo">Passar para</span>
              <select
                name="destino"
                defaultValue={alocacao?.modalidade === 'UNIDADE' ? `UNIDADE:${alocacao.unidadeId}` : alocacao?.modalidade ?? ''}
                className="esc-input w-56"
                aria-label={`Nova alocação de ${c.nome} em ${formatarData(data)}`}
              >
                {ativas.map(u => (
                  <option key={u.id} value={`UNIDADE:${u.id}`}>
                    {u.nome} ({lotacao.find(l => l.unidade.id === u.id)?.dentro} de {lotacao.find(l => l.unidade.id === u.id)?.lugares})
                  </option>
                ))}
                {(['HOME', 'EXTERNO', 'EVENTO', 'TREINA', 'FOLGA', 'AFAST'] as const).map(m => (
                  <option key={m} value={m}>{MODALIDADES[m].label}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="esc-btn esc-btn-sm">Salvar o dia</button>
          </form>

          {alocacao && (
            <form action={alternarTrava} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="colaboradorId" value={c.id} />
              <input type="hidden" name="data" value={data} />
              <input type="hidden" name="competencia" value={competencia} />
              <input type="hidden" name="volta" value={volta} />
              <input type="hidden" name="modalidade" value={alocacao.modalidade} />
              <input type="hidden" name="unidadeId" value={alocacao.unidadeId ?? ''} />
              <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">
                {alocacao.travado ? 'Liberar a trava deste dia' : 'Travar este dia'}
              </button>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {alocacao.travado
                  ? 'Enquanto travado, uma nova geração não mexe neste dia.'
                  : 'Travado, o dia sobrevive a uma nova geração.'}
              </span>
            </form>
          )}

          {ausente && (
            <p className="text-[11.5px]" style={{ color: 'var(--amber)' }}>
              Esta pessoa está marcada como <strong>{atual?.label.toLowerCase()}</strong> neste dia. Trazê-la
              de volta para uma unidade aqui muda só a escala — a ausência aprovada continua registrada.
            </p>
          )}
        </div>
      ) : (
        <p className="px-4 py-4 text-[12px]" style={{ color: 'var(--muted)' }}>
          Este mês está encerrado e não recebe mais ajustes.
        </p>
      )}
    </Bloco>
  );
}
