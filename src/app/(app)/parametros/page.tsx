import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao } from '@/lib/sessao';
import { createClient } from '@/lib/supabase/server';
import { getConfig, listarEquipes, listarFeriados, listarLogs, listarUnidades } from '@/lib/data/escalas';
import { DIAS_ABREV, dowDeIso, formatarData } from '@/lib/domain/escalas/datas';
import { REGRAS_MOTOR } from '@/lib/domain/escalas/constantes';
import { comFiltros, texto, type Busca } from '@/lib/pagina';
import {
  removerFeriado, salvarCapacidade, salvarEquipe, salvarFeriado, salvarParametros, salvarUnidade,
} from '@/app/actions-cadastros';
import { Abas, Aviso, Badge, Bloco, Vazio } from '@/components/Ui';

const UTEIS = [1, 2, 3, 4, 5];

export default async function ParametrosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (sessao.papel !== 'planejamento') redirect('/');

  const supabase = await createClient();
  const [unidades, equipes, config, feriados, logs, capRes, perfisRes] = await Promise.all([
    listarUnidades(),
    listarEquipes(),
    getConfig(sessao.conta.id),
    listarFeriados(),
    listarLogs(50),
    supabase.from('capacidades').select('*'),
    supabase.from('perfis').select('id, nome, papel').order('nome'),
  ]);
  const capacidades = (capRes.data ?? []) as { unidade_id: number; dow: number | null; data: string | null; total: number; reservadas: number }[];
  const perfis = (perfisRes.data ?? []) as { id: string; nome: string; papel: string | null }[];

  const aba = texto(busca, 'aba') || 'unidades';
  const href = (a: string) => `/parametros${comFiltros(busca, { aba: a })}`;
  const editandoUnidade = unidades.find(u => u.id === Number(texto(busca, 'unidade')));
  const editandoEquipe = equipes.find(e => e.id === Number(texto(busca, 'equipe')));

  return (
    <>
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Parâmetros</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          Unidades, capacidade, equipes, feriados e as regras que o motor aplica.
        </p>
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      <Abas
        ativa={aba}
        itens={[
          { chave: 'unidades', label: 'Unidades e capacidade', href: href('unidades') },
          { chave: 'equipes', label: 'Equipes', href: href('equipes') },
          { chave: 'feriados', label: 'Feriados', href: href('feriados') },
          { chave: 'motor', label: 'Regras do motor', href: href('motor') },
          { chave: 'auditoria', label: 'Auditoria e LGPD', href: href('auditoria') },
        ]}
      />

      {aba === 'unidades' && (
        <>
          <Bloco
            titulo="Unidades"
            desc="Cada unidade tem uma capacidade total e um número de posições reservadas (visitantes, sala de reunião, etc.). O motor nunca aloca acima de total menos reservadas."
          >
            {unidades.length === 0 ? (
              <Vazio titulo="Nenhuma unidade cadastrada" desc="Cadastre ao menos uma unidade física antes de montar a primeira escala." />
            ) : (
              <div className="overflow-x-auto">
                <table className="esc-tabela">
                  <thead>
                    <tr>
                      <th>Unidade</th><th>Sigla</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Reservadas</th>
                      <th className="text-right">Operacionais</th>
                      <th>Situação</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {unidades.map(u => (
                      <tr key={u.id}>
                        <td className="font-medium" style={{ color: u.cor }}>{u.nome}</td>
                        <td><Badge cor={u.cor} bg={u.bg}>{u.sigla}</Badge></td>
                        <td className="text-right esc-num">{u.capacidadeTotal}</td>
                        <td className="text-right esc-num">{u.capacidadeReservadas}</td>
                        <td className="text-right esc-num font-semibold">{u.capacidadeTotal - u.capacidadeReservadas}</td>
                        <td>
                          {u.ativa
                            ? <Badge cor="var(--green)" bg="var(--green-bg)">Ativa</Badge>
                            : <Badge cor="var(--muted)" bg="var(--bg)">Inativa</Badge>}
                        </td>
                        <td className="text-right">
                          <Link href={`/parametros${comFiltros(busca, { unidade: String(u.id) })}`} className="esc-btn esc-btn-outline esc-btn-sm">
                            Editar
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form action={salvarUnidade} className="px-4 py-3 border-t grid gap-3 sm:grid-cols-3 lg:grid-cols-4" style={{ borderColor: 'var(--line)' }}>
              {editandoUnidade && <input type="hidden" name="id" value={editandoUnidade.id} />}
              <label className="block">
                <span className="esc-rotulo">Nome</span>
                <input name="nome" defaultValue={editandoUnidade?.nome} required className="esc-input" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Código</span>
                <input name="codigo" defaultValue={editandoUnidade?.codigo} required className="esc-input" placeholder="MOR" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Sigla</span>
                <input name="sigla" defaultValue={editandoUnidade?.sigla} required className="esc-input" placeholder="MOR" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Ordem</span>
                <input type="number" name="ordem" defaultValue={editandoUnidade?.ordem ?? unidades.length + 1} className="esc-input esc-num" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Capacidade total</span>
                <input type="number" name="capacidadeTotal" min={0} defaultValue={editandoUnidade?.capacidadeTotal ?? 10} required className="esc-input esc-num" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Posições reservadas</span>
                <input type="number" name="capacidadeReservadas" min={0} defaultValue={editandoUnidade?.capacidadeReservadas ?? 0} required className="esc-input esc-num" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Cor</span>
                <input type="color" name="cor" defaultValue={editandoUnidade?.cor ?? '#1A4E93'} className="esc-input h-[34px] p-1" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Cor de fundo</span>
                <input type="color" name="bg" defaultValue={editandoUnidade?.bg ?? '#DCEAF8'} className="esc-input h-[34px] p-1" />
              </label>
              <label className="flex items-center gap-2 text-[12.5px] pt-5">
                <input type="checkbox" name="ativa" defaultChecked={editandoUnidade?.ativa ?? true} /> Unidade ativa
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" className="esc-btn">{editandoUnidade ? 'Salvar unidade' : 'Adicionar unidade'}</button>
                {editandoUnidade && (
                  <Link href={`/parametros${comFiltros(busca, { unidade: null })}`} className="esc-btn esc-btn-ghost esc-btn-sm">
                    Cancelar
                  </Link>
                )}
              </div>
            </form>
          </Bloco>

          {unidades.length > 0 && (
            <Bloco
              titulo="Capacidade excepcional"
              desc="Sobrepõe a capacidade padrão num dia da semana ou numa data específica. Data exata tem precedência sobre dia da semana. Deixe a capacidade em branco para remover a exceção."
            >
              <div className="overflow-x-auto">
                <table className="esc-tabela">
                  <thead>
                    <tr><th>Unidade</th><th>Quando</th><th className="text-right">Total</th><th className="text-right">Reservadas</th></tr>
                  </thead>
                  <tbody>
                    {capacidades.length === 0 && (
                      <tr><td colSpan={4} className="text-center py-6" style={{ color: 'var(--muted)' }}>Nenhuma exceção cadastrada — vale a capacidade padrão da unidade.</td></tr>
                    )}
                    {capacidades.map((c, i) => (
                      <tr key={i}>
                        <td>{unidades.find(u => u.id === c.unidade_id)?.nome ?? '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>
                          {c.data ? `Data ${formatarData(c.data)}` : `Toda ${DIAS_ABREV[c.dow ?? 0].toLowerCase()}`}
                        </td>
                        <td className="text-right esc-num">{c.total}</td>
                        <td className="text-right esc-num">{c.reservadas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form action={salvarCapacidade} className="px-4 py-3 border-t flex flex-wrap items-end gap-3" style={{ borderColor: 'var(--line)' }}>
                <label className="block">
                  <span className="esc-rotulo">Unidade</span>
                  <select name="unidadeId" required className="esc-input w-44">
                    {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="esc-rotulo">Dia da semana</span>
                  <select name="dow" className="esc-input w-36">
                    <option value="">—</option>
                    {UTEIS.map(d => <option key={d} value={d}>{DIAS_ABREV[d]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="esc-rotulo">ou Data</span>
                  <input type="date" name="data" className="esc-input w-40" />
                </label>
                <label className="block">
                  <span className="esc-rotulo">Total</span>
                  <input type="number" name="total" min={0} className="esc-input w-24 esc-num" />
                </label>
                <label className="block">
                  <span className="esc-rotulo">Reservadas</span>
                  <input type="number" name="reservadas" min={0} defaultValue={0} className="esc-input w-24 esc-num" />
                </label>
                <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Salvar exceção</button>
              </form>
            </Bloco>
          )}

          <Bloco titulo="Motor" desc="Ajustes globais que mudam como o motor decide.">
            <form action={salvarParametros} className="px-4 py-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="esc-rotulo">Âncora do ciclo 12x36</span>
                <input type="month" name="cicloAncoraMes" defaultValue={config.cicloAncora.slice(0, 7)} className="esc-input w-44" disabled />
                <input type="hidden" name="cicloAncora" value={config.cicloAncora} />
              </label>
              <label className="block">
                <span className="esc-rotulo">Tolerância de aderência (dias)</span>
                <input type="number" name="tolerancia" min={0} max={10} defaultValue={config.toleranciaAderencia} className="esc-input w-32 esc-num" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Cobertura mínima por unidade</span>
                <input type="number" name="cobertura" min={0} max={50} defaultValue={config.coberturaMinima} className="esc-input w-32 esc-num" />
              </label>
              <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Salvar parâmetros</button>
              <p className="text-[11px] w-full" style={{ color: 'var(--muted)' }}>
                A âncora define a partir de qual mês a paridade par/ímpar do 12x36 é contada. Mudá-la desloca o ciclo
                de todo mundo, então ela fica travada aqui: altere direto em <code>config</code> se for mesmo
                necessário.
              </p>
            </form>
          </Bloco>
        </>
      )}

      {aba === 'equipes' && (
        <Bloco titulo="Equipes" desc="A equipe define o regime de trabalho e o gestor responsável pelas aprovações.">
          <div className="overflow-x-auto">
            <table className="esc-tabela">
              <thead>
                <tr><th>Equipe</th><th>Código</th><th>Regime</th><th>Turno</th><th>Gestor</th><th /></tr>
              </thead>
              <tbody>
                {equipes.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--muted)' }}>Nenhuma equipe cadastrada.</td></tr>
                )}
                {equipes.map(e => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.nome}</td>
                    <td className="esc-num" style={{ color: 'var(--muted)' }}>{e.codigo}</td>
                    <td><Badge cor="var(--brand-700)" bg="var(--brand-100)">{e.regime}</Badge></td>
                    <td style={{ color: 'var(--muted)' }}>{e.turno === 'N' ? 'Noturno' : 'Diurno'}</td>
                    <td style={{ color: 'var(--muted)' }}>{perfis.find(p => p.id === e.gestorId)?.nome ?? '—'}</td>
                    <td className="text-right">
                      <Link href={`/parametros${comFiltros(busca, { aba: 'equipes', equipe: String(e.id) })}`} className="esc-btn esc-btn-outline esc-btn-sm">
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={salvarEquipe} className="px-4 py-3 border-t flex flex-wrap items-end gap-3" style={{ borderColor: 'var(--line)' }}>
            {editandoEquipe && <input type="hidden" name="id" value={editandoEquipe.id} />}
            <label className="block">
              <span className="esc-rotulo">Nome</span>
              <input name="nome" defaultValue={editandoEquipe?.nome} required className="esc-input w-56" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Código</span>
              <input name="codigo" defaultValue={editandoEquipe?.codigo} required className="esc-input w-28" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Regime</span>
              <select name="regime" defaultValue={editandoEquipe?.regime ?? '5x2'} className="esc-input w-32">
                <option value="5x2">5x2</option>
                <option value="12x36">12x36</option>
              </select>
            </label>
            <label className="block">
              <span className="esc-rotulo">Turno</span>
              <select name="turno" defaultValue={editandoEquipe?.turno ?? 'D'} className="esc-input w-32">
                <option value="D">Diurno</option>
                <option value="N">Noturno</option>
              </select>
            </label>
            <label className="block">
              <span className="esc-rotulo">Gestor</span>
              <select name="gestorId" defaultValue={editandoEquipe?.gestorId ?? ''} className="esc-input w-52">
                <option value="">Sem gestor</option>
                {perfis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button type="submit" className="esc-btn">{editandoEquipe ? 'Salvar equipe' : 'Adicionar equipe'}</button>
            {editandoEquipe && (
              <Link href={`/parametros${comFiltros(busca, { aba: 'equipes', equipe: null })}`} className="esc-btn esc-btn-ghost esc-btn-sm">
                Cancelar
              </Link>
            )}
          </form>
        </Bloco>
      )}

      {aba === 'feriados' && (
        <Bloco
          titulo="Feriados"
          desc="Colaboradores 5x2 folgam automaticamente. Plantões 12x36 não são afetados: o feriado não desloca o ciclo."
        >
          <div className="overflow-x-auto max-h-[500px]">
            <table className="esc-tabela">
              <thead><tr><th>Data</th><th>Dia</th><th>Feriado</th><th /></tr></thead>
              <tbody>
                {feriados.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6" style={{ color: 'var(--muted)' }}>Nenhum feriado cadastrado.</td></tr>
                )}
                {feriados.map(f => (
                  <tr key={f.data}>
                    <td className="esc-num">{formatarData(f.data)}</td>
                    <td style={{ color: 'var(--muted)' }}>{DIAS_ABREV[dowDeIso(f.data)]}</td>
                    <td className="font-medium">{f.nome}</td>
                    <td className="text-right">
                      <form action={removerFeriado} className="inline">
                        <input type="hidden" name="data" value={f.data} />
                        <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">Remover</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={salvarFeriado} className="px-4 py-3 border-t flex flex-wrap items-end gap-3" style={{ borderColor: 'var(--line)' }}>
            <label className="block">
              <span className="esc-rotulo">Data</span>
              <input type="date" name="data" required className="esc-input w-40" />
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="esc-rotulo">Nome</span>
              <input name="nome" required className="esc-input" placeholder="Ex.: Consciência Negra" />
            </label>
            <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Adicionar feriado</button>
          </form>
        </Bloco>
      )}

      {aba === 'motor' && (
        <Bloco titulo="Precedência das regras" desc="A ordem em que o motor decide cada dia. Regras rígidas nunca são violadas; as flexíveis são otimizadas no que sobra.">
          <ol className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {REGRAS_MOTOR.map(r => (
              <li key={r.n} className="px-4 py-3 flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-md grid place-items-center text-[11px] font-semibold esc-num" style={{ background: 'var(--brand-100)', color: 'var(--brand-800)' }}>
                  {r.n}
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12.5px] font-semibold">{r.titulo}</span>
                    <Badge
                      cor={r.rigida ? 'var(--rose)' : 'var(--muted)'}
                      bg={r.rigida ? 'var(--rose-bg)' : 'var(--bg)'}
                    >
                      {r.rigida ? 'Rígida' : 'Flexível'}
                    </Badge>
                  </div>
                  <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>{r.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Bloco>
      )}

      {aba === 'auditoria' && (
        <>
          <Bloco titulo="Log de auditoria" desc="Toda alteração relevante do módulo é gravada com autor e horário.">
            {logs.length === 0 ? (
              <Vazio titulo="Nada registrado ainda" desc="As ações do módulo aparecem aqui conforme forem executadas." />
            ) : (
              <div className="overflow-x-auto max-h-[520px]">
                <table className="esc-tabela">
                  <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td className="esc-num whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                          {new Date(l.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="font-medium">{l.usuario_nome}</td>
                        <td>{l.acao}</td>
                        <td style={{ color: 'var(--muted)' }}>{l.detalhe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloco>

          <Bloco titulo="Proteção de dados" desc="Como o módulo trata informação pessoal e de saúde.">
            <ul className="px-4 py-3 space-y-2 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              <li>
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>Isolamento por conta.</strong>{' '}
                Todas as tabelas do módulo têm Row Level Security ligada por <code>conta_id</code>: nenhuma consulta
                atravessa contas, nem por acesso direto à API.
              </li>
              <li>
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>Recorte por papel no banco.</strong>{' '}
                Gestor lê apenas colaboradores das equipes que gerencia; colaborador lê apenas a própria linha. Isso é
                política de RLS, não só filtro de tela — motivos de atestado não trafegam para quem não tem direito a
                vê-los.
              </li>
              <li>
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>Rascunho não vaza.</strong>{' '}
                Uma escala em rascunho é invisível para o papel colaborador até ser publicada.
              </li>
              <li>
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>Rastreabilidade.</strong>{' '}
                Decisões de solicitação guardam autor, horário e justificativa em trilha append-only; alterações de
                cadastro e geração ficam no log acima.
              </li>
              <li>
                Ausências por motivo de saúde são dado sensível. Defina uma política de retenção e revise
                periodicamente quem tem papel de Planejamento na conta.
              </li>
            </ul>
          </Bloco>
        </>
      )}
    </>
  );
}
