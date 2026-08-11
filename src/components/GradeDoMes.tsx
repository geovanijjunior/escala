import Link from 'next/link';
import { DIAS_INICIAL, diaSemana, diasNoMes, iso } from '@/lib/domain/escalas/datas';
import { aparencia } from './Ui';
import { ExportarCsv } from './ExportarCsv';
import type { Alocacao, Colaborador, Equipe, Unidade } from '@/lib/domain/escalas/tipos';

interface Props {
  ano: number;
  mes: number;
  competencia: string;
  colaboradores: Colaborador[];
  equipes: Equipe[];
  unidades: Unidade[];
  alocacoes: Alocacao[];
  feriados: Record<string, string>;
  capacidadeDia: Record<string, Record<number, number>>;
  baseHref: string;
}

/**
 * Planilha do mês: uma linha por pessoa, uma coluna por dia.
 *
 * Cabeçalho, primeira coluna e rodapé de totais ficam grudados nas bordas — com
 * 60 linhas por 31 colunas, perder a referência de quem é a linha ou que dia é a
 * coluna torna a grade ilegível.
 */
export function GradeDoMes({
  ano, mes, competencia, colaboradores, equipes, unidades, alocacoes, feriados, capacidadeDia, baseHref,
}: Props) {
  const nDias = diasNoMes(ano, mes);
  const dias = Array.from({ length: nDias }, (_, i) => i + 1);
  const ativas = unidades.filter(u => u.ativa);
  const equipePorId = new Map(equipes.map(e => [e.id, e]));

  const porColabData = new Map<string, Alocacao>();
  for (const a of alocacoes) porColabData.set(`${a.colaboradorId}|${a.data}`, a);

  const ordenados = [...colaboradores].sort(
    (a, b) => (equipePorId.get(a.equipeId)?.nome ?? '').localeCompare(equipePorId.get(b.equipeId)?.nome ?? '') || a.nome.localeCompare(b.nome)
  );

  const totalPorColab = (c: Colaborador) => {
    const t: Record<string, number> = { HOME: 0 };
    for (const u of ativas) t[`U${u.id}`] = 0;
    for (const d of dias) {
      const a = porColabData.get(`${c.id}|${iso(ano, mes, d)}`);
      if (!a) continue;
      if (a.modalidade === 'UNIDADE' && a.unidadeId) t[`U${a.unidadeId}`]++;
      else if (a.modalidade === 'HOME') t.HOME++;
    }
    return t;
  };

  const ocupacaoDia = (data: string, unidadeId: number) =>
    alocacoes.filter(a => a.data === data && a.modalidade === 'UNIDADE' && a.unidadeId === unidadeId).length;

  const linhasCsv: string[][] = [
    ['Colaborador', 'Matrícula', 'Equipe', 'Cargo', 'Entrada', ...dias.map(String), ...ativas.map(u => u.sigla), 'HOME'],
    ...ordenados.map(c => {
      const t = totalPorColab(c);
      return [
        c.nome, c.matricula, equipePorId.get(c.equipeId)?.nome ?? '', c.cargo, c.entrada,
        ...dias.map(d => {
          const a = porColabData.get(`${c.id}|${iso(ano, mes, d)}`);
          return a ? aparencia(a.modalidade, a.unidadeId, unidades).sigla : '';
        }),
        ...ativas.map(u => String(t[`U${u.id}`])),
        String(t.HOME),
      ];
    }),
  ];

  if (ordenados.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
        Nenhum colaborador corresponde aos filtros selecionados.
      </p>
    );
  }

  // Onde cada bloco de equipe começa, calculado antes de renderizar — a lista já
  // vem ordenada por equipe, então basta comparar com a linha anterior.
  const inicioDeEquipe = new Set(
    ordenados.filter((c, i) => i === 0 || ordenados[i - 1].equipeId !== c.equipeId).map(c => c.id)
  );

  return (
    <div>
      <div className="px-4 py-2 flex justify-end border-b" style={{ borderColor: 'var(--line)' }}>
        <ExportarCsv linhas={linhasCsv} nomeArquivo={`escala-${competencia.slice(0, 7)}.csv`} rotulo="Exportar grade" />
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="esc-tabela" style={{ minWidth: `${360 + nDias * 30 + ativas.length * 44}px` }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30" style={{ background: '#F8FAFC', minWidth: 210 }}>Colaborador</th>
              {dias.map(d => {
                const data = iso(ano, mes, d);
                const dow = diaSemana(ano, mes, d);
                const especial = [0, 6].includes(dow) || !!feriados[data];
                return (
                  <th
                    key={d}
                    className="text-center px-0"
                    style={{ minWidth: 30, background: especial ? 'var(--bg)' : '#F8FAFC' }}
                    title={feriados[data] ?? undefined}
                  >
                    <div style={{ color: 'var(--faint)' }}>{DIAS_INICIAL[dow]}</div>
                    <div className="esc-num" style={{ color: 'var(--text)' }}>{d}</div>
                  </th>
                );
              })}
              {ativas.map(u => <th key={u.id} className="text-center px-1">{u.sigla}</th>)}
              <th className="text-center px-1">HOME</th>
            </tr>
          </thead>

          <tbody>
            {ordenados.flatMap(c => {
              const t = totalPorColab(c);
              const equipe = equipePorId.get(c.equipeId);
              const linhas = [];
              if (inicioDeEquipe.has(c.id)) {
                linhas.push(
                  <tr key={`eq-${c.equipeId}`}>
                    <td
                      colSpan={1 + nDias + ativas.length + 1}
                      className="sticky left-0 text-[10.5px] font-semibold uppercase tracking-wider py-1"
                      style={{ background: 'var(--brand-50)', color: 'var(--brand-800)' }}
                    >
                      {equipe?.nome ?? 'Sem equipe'} · {equipe?.regime} · turno {equipe?.turno === 'N' ? 'noturno' : 'diurno'}
                    </td>
                  </tr>
                );
              }

              linhas.push(
                <tr key={c.id}>
                  <td className="sticky left-0 z-10" style={{ background: 'var(--surface)' }}>
                    <div className="font-medium truncate max-w-[190px]">{c.nome}</div>
                    <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                      {c.cargo} · {c.entrada}
                    </div>
                  </td>
                  {dias.map(d => {
                    const data = iso(ano, mes, d);
                    const a = porColabData.get(`${c.id}|${data}`);
                    if (!a || a.modalidade === 'DESCANSO') {
                      return (
                        <td key={d} className="text-center px-0" style={{ color: 'var(--faint)', background: 'var(--bg)' }}>
                          ·
                        </td>
                      );
                    }
                    const ap = aparencia(a.modalidade, a.unidadeId, unidades);
                    return (
                      <td key={d} className="p-0.5 text-center">
                        <Link
                          href={`${baseHref}${baseHref.includes('?') ? '&' : '?'}dia=${data}`}
                          className="block rounded text-[9.5px] font-semibold leading-[18px] relative"
                          style={{ background: ap.bg, color: ap.cor }}
                          title={`${c.nome} · ${data.split('-').reverse().join('/')} · ${ap.label}${a.travado ? ' (travado)' : ''}`}
                        >
                          {ap.sigla}
                          {a.travado && (
                            <span className="absolute -top-px -right-px text-[7px] leading-none" aria-label="travado">
                              ▪
                            </span>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                  {ativas.map(u => (
                    <td key={u.id} className="text-center esc-num font-semibold" style={{ color: u.cor }}>
                      {t[`U${u.id}`]}
                    </td>
                  ))}
                  <td className="text-center esc-num font-semibold" style={{ color: '#6D28D9' }}>{t.HOME}</td>
                </tr>
              );
              return linhas;
            })}
          </tbody>

          <tfoot className="sticky bottom-0 z-20">
            {ativas.map(u => (
              <tr key={u.id}>
                <td className="sticky left-0 z-30 text-[11px] font-semibold" style={{ background: '#F8FAFC' }}>
                  Ocupação {u.nome}
                </td>
                {dias.map(d => {
                  const data = iso(ano, mes, d);
                  const n = ocupacaoDia(data, u.id);
                  const cap = capacidadeDia[data]?.[u.id] ?? 0;
                  const cheio = cap > 0 && n >= cap;
                  return (
                    <td
                      key={d}
                      className="text-center esc-num text-[10px] font-semibold px-0"
                      style={{
                        background: cheio ? 'var(--rose-bg)' : '#F8FAFC',
                        color: cheio ? 'var(--rose)' : 'var(--muted)',
                      }}
                      title={`${n} de ${cap} posições`}
                    >
                      {n}
                    </td>
                  );
                })}
                <td colSpan={ativas.length + 1} style={{ background: '#F8FAFC' }} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <div className="px-4 py-2.5 flex flex-wrap gap-2 border-t" style={{ borderColor: 'var(--line)' }}>
        {ativas.map(u => (
          <span key={u.id} className="esc-badge" style={{ color: u.cor, background: u.bg }}>{u.sigla} · {u.nome}</span>
        ))}
        <span className="esc-badge" style={{ color: '#6D28D9', background: '#EDE9FE' }}>HO · Home Office</span>
        <span className="esc-badge" style={{ color: '#B45309', background: '#FEF3C7' }}>FÉR · Férias</span>
        <span className="esc-badge" style={{ color: '#526176', background: '#F1F5F9' }}>AUS · Ausência</span>
        <span className="text-[10.5px] self-center" style={{ color: 'var(--muted)' }}>▪ marca alocação travada</span>
      </div>
    </div>
  );
}
