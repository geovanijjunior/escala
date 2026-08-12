import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessao, podeCadastrar } from '@/lib/sessao';
import { createClient } from '@/lib/supabase/server';
import { listarColaboradores, listarEquipes, listarUnidades } from '@/lib/data/escalas';
import { formatarData, somaHoras } from '@/lib/domain/escalas/datas';
import { CARGOS } from '@/lib/domain/escalas/constantes';
import { comFiltros, texto, type Busca } from '@/lib/pagina';
import { salvarColaborador } from '@/app/actions-cadastros';
import { Aviso, Badge, Bloco, Pill, Vazio } from '@/components/Ui';
import { Volta } from '@/components/Volta';
import { FiltrosAuto } from '@/components/FiltrosAuto';
import { SituacaoColaborador } from '@/components/SituacaoColaborador';
import { ImportarColaboradores } from '@/components/ImportarColaboradores';
import type { Colaborador } from '@/lib/domain/escalas/tipos';

const SITUACAO = {
  ativo: { label: 'Ativo', cor: 'var(--green)', bg: 'var(--green-bg)' },
  afastado: { label: 'Afastado', cor: 'var(--amber)', bg: 'var(--amber-bg)' },
  desligado: { label: 'Desligado', cor: 'var(--muted)', bg: 'var(--bg)' },
} as const;

export default async function ColaboradoresPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const sessao = await getSessao();
  if (!podeCadastrar(sessao.papel)) redirect('/');

  const supabase = await createClient();
  const [colaboradores, equipes, unidades, perfisRes] = await Promise.all([
    listarColaboradores(),
    listarEquipes(),
    listarUnidades(),
    supabase.from('perfis').select('id, nome, email, papel').order('nome'),
  ]);
  const perfis = (perfisRes.data ?? []) as { id: string; nome: string; email: string; papel: string | null }[];

  const equipePorId = new Map(equipes.map(e => [e.id, e]));
  const unidadePorId = new Map(unidades.map(u => [u.id, u]));
  const perfilPorId = new Map(perfis.map(p => [p.id, p]));

  const statusFiltro = texto(busca, 'status') || 'ativo';
  const equipeFiltro = Number(texto(busca, 'equipe')) || null;
  const nomeFiltro = texto(busca, 'q').toLowerCase();

  const listados = colaboradores.filter(c => {
    if (statusFiltro !== 'todos' && c.status !== statusFiltro) return false;
    if (equipeFiltro && c.equipeId !== equipeFiltro) return false;
    if (nomeFiltro && !`${c.nome} ${c.matricula}`.toLowerCase().includes(nomeFiltro)) return false;
    return true;
  });

  const editandoId = Number(texto(busca, 'id')) || null;
  const novo = texto(busca, 'novo') === '1';
  const importar = texto(busca, 'importar') === '1';
  const edicao = editandoId ? colaboradores.find(c => c.id === editandoId) ?? null : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Colaboradores</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Cadastro base da escala: equipe, regime, jornada, elegibilidades e vínculo com o usuário do sistema.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/colaboradores${comFiltros(busca, { importar: '1', novo: null, id: null })}`} className="esc-btn esc-btn-outline esc-btn-sm">
            Importar planilha
          </Link>
          <Link href={`/colaboradores${comFiltros(busca, { novo: '1', importar: null, id: null })}`} className="esc-btn esc-btn-sm">
            Novo colaborador
          </Link>
        </div>
      </div>

      <Aviso erro={texto(busca, 'erro') || undefined} ok={texto(busca, 'ok') || undefined} />

      {unidades.length === 0 || equipes.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Faltam unidades e equipes"
            desc="Um colaborador precisa pertencer a uma equipe e ter uma unidade base. Cadastre-as primeiro em Parâmetros."
            acao={<Link href="/parametros" className="esc-btn">Ir para Parâmetros</Link>}
          />
        </Bloco>
      ) : (
        <>
          {importar && (
            <Bloco
              titulo="Importar colaboradores de uma planilha"
              desc="Escolha o arquivo, confira o que vai acontecer e só então grave."
              acoes={
                <Link
                  href={`/colaboradores${comFiltros(busca, { importar: null })}`}
                  className="esc-btn esc-btn-ghost esc-btn-sm"
                >
                  Fechar
                </Link>
              }
            >
              <ImportarColaboradores />
            </Bloco>
          )}

          {(novo || edicao) && (
            <Formulario
              colaborador={edicao}
              equipes={equipes}
              unidades={unidades}
              perfis={perfis}
              fecharHref={`/colaboradores${comFiltros(busca, { novo: null, id: null })}`}
              busca={busca}
            />
          )}

          <Bloco titulo={`${listados.length} colaborador(es)`}>
            <form method="get" className="px-4 py-3 flex flex-wrap items-end gap-3 border-b" style={{ borderColor: 'var(--line)' }}>
              <FiltrosAuto />
              <label className="block">
                <span className="esc-rotulo">Buscar</span>
                <input name="q" defaultValue={texto(busca, 'q')} placeholder="Nome ou matrícula" className="esc-input w-52" />
              </label>
              <label className="block">
                <span className="esc-rotulo">Equipe</span>
                <select name="equipe" defaultValue={texto(busca, 'equipe')} className="esc-input w-48">
                  <option value="">Todas</option>
                  {equipes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="esc-rotulo">Situação</span>
                <select name="status" defaultValue={statusFiltro} className="esc-input w-36">
                  <option value="ativo">Ativos</option>
                  <option value="afastado">Afastados</option>
                  <option value="desligado">Desligados</option>
                  <option value="todos">Todos</option>
                </select>
              </label>
              <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Aplicar</button>
            </form>

            {listados.length === 0 ? (
              <Vazio titulo="Nenhum colaborador nesse filtro" desc="Ajuste os filtros ou cadastre um novo colaborador." />
            ) : (
              <div className="overflow-x-auto">
                <table className="esc-tabela">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Cargo</th>
                      <th>Equipe · Regime</th>
                      <th>Jornada</th>
                      <th>Unidade base</th>
                      <th>Acesso</th>
                      <th>Admissão</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {listados.map(c => {
                      const equipe = equipePorId.get(c.equipeId);
                      const saida = somaHoras(c.entrada, c.jornada + (c.jornada > 6 ? 1 : 0));
                      const perfil = c.perfilId ? perfilPorId.get(c.perfilId) : null;
                      const sit = SITUACAO[c.status];
                      return (
                        <tr key={c.id}>
                          <td>
                            <div className="font-medium">{c.nome}</div>
                            <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                              {c.matricula}{c.email ? ` · ${c.email}` : ''}
                            </div>
                          </td>
                          <td style={{ color: 'var(--muted)' }}>{c.cargo || '—'}</td>
                          <td style={{ color: 'var(--muted)' }}>
                            {equipe?.nome ?? '—'}
                            <div className="flex gap-1 mt-0.5">
                              <Badge cor="var(--brand-700)" bg="var(--brand-100)">{c.regime}</Badge>
                              <Badge cor="var(--muted)" bg="var(--bg)">{c.turno === 'N' ? 'Noturno' : 'Diurno'}</Badge>
                              {c.elegHome && <Badge cor="#6D28D9" bg="#EDE9FE">HOME</Badge>}
                            </div>
                          </td>
                          <td className="esc-num" style={{ color: 'var(--muted)' }}>
                            {c.entrada}–{saida}
                            {c.sextaReduzida && <div className="text-[10px]">sexta −1h</div>}
                          </td>
                          <td style={{ color: unidadePorId.get(c.unidadeBaseId)?.cor }}>
                            {unidadePorId.get(c.unidadeBaseId)?.nome ?? '—'}
                          </td>
                          <td style={{ color: 'var(--muted)' }} className="text-[11px]">
                            {perfil ? `${perfil.nome} (${perfil.papel ?? 'sem papel'})` : 'Sem login'}
                          </td>
                          <td className="esc-num" style={{ color: 'var(--muted)' }}>{formatarData(c.admissao)}</td>
                          <td><Pill cor={sit.cor} bg={sit.bg}>{sit.label}</Pill></td>
                          <td className="text-right">
                            <Link
                              href={`/colaboradores${comFiltros(busca, { id: String(c.id), novo: null })}`}
                              className="esc-btn esc-btn-outline esc-btn-sm"
                            >
                              Editar
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Bloco>
        </>
      )}
    </>
  );
}

function Formulario({
  colaborador: c, equipes, unidades, perfis, fecharHref, busca,
}: {
  colaborador: Colaborador | null;
  equipes: { id: number; nome: string; regime: string; turno: string }[];
  unidades: { id: number; nome: string; ativa: boolean }[];
  perfis: { id: string; nome: string; email: string; papel: string | null }[];
  fecharHref: string;
  busca: Busca;
}) {
  return (
    <Bloco
      id="editor-colaborador"
      titulo={c ? `Editar ${c.nome}` : 'Novo colaborador'}
      desc="Regime e turno vêm da equipe escolhida; o turno pode ser sobreposto caso a caso."
      acoes={<Link href={fecharHref} className="esc-btn esc-btn-ghost esc-btn-sm">Fechar</Link>}
    >
      <form action={salvarColaborador} className="px-4 py-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Volta busca={busca} ancora="editor-colaborador" />
        {c && <input type="hidden" name="id" value={c.id} />}

        <label className="block">
          <span className="esc-rotulo">Nome</span>
          <input name="nome" defaultValue={c?.nome} required className="esc-input" />
        </label>
        <label className="block">
          <span className="esc-rotulo">Matrícula</span>
          <input name="matricula" defaultValue={c?.matricula} required className="esc-input esc-num" />
        </label>
        <label className="block">
          <span className="esc-rotulo">E-mail</span>
          <input type="email" name="email" defaultValue={c?.email} className="esc-input" />
        </label>

        <label className="block">
          <span className="esc-rotulo">Cargo</span>
          <select name="cargo" defaultValue={c?.cargo} className="esc-input">
            <option value="">—</option>
            {CARGOS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="esc-rotulo">Equipe</span>
          <select name="equipeId" defaultValue={c?.equipeId} required className="esc-input">
            <option value="">Selecione</option>
            {equipes.map(e => <option key={e.id} value={e.id}>{e.nome} ({e.regime})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="esc-rotulo">Turno</span>
          <select name="turno" defaultValue={c?.turno ?? 'D'} className="esc-input">
            <option value="D">Diurno</option>
            <option value="N">Noturno</option>
          </select>
        </label>

        <label className="block">
          <span className="esc-rotulo">Ciclo base (12x36)</span>
          <select name="ciclo" defaultValue={c?.ciclo ?? ''} className="esc-input">
            <option value="">Não se aplica</option>
            <option value="IMPAR">Dias ímpares</option>
            <option value="PAR">Dias pares</option>
          </select>
        </label>
        <label className="block">
          <span className="esc-rotulo">Entrada</span>
          <input type="time" name="entrada" defaultValue={c?.entrada ?? '08:00'} required className="esc-input esc-num" />
        </label>
        <label className="block">
          <span className="esc-rotulo">Jornada diária (horas)</span>
          <input type="number" name="jornada" min={1} max={24} step={0.5} defaultValue={c?.jornada ?? 8} required className="esc-input esc-num" />
        </label>

        <label className="block">
          <span className="esc-rotulo">Unidade base</span>
          <select name="unidadeBaseId" defaultValue={c?.unidadeBaseId} required className="esc-input">
            <option value="">Selecione</option>
            {unidades.filter(u => u.ativa).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="esc-rotulo">Usuário do sistema</span>
          <select name="perfilId" defaultValue={c?.perfilId ?? ''} className="esc-input">
            <option value="">Sem login vinculado</option>
            {perfis.map(p => <option key={p.id} value={p.id}>{p.nome} — {p.email}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="esc-rotulo">Gestor</span>
          <select name="gestorId" defaultValue={c?.gestorId ?? ''} className="esc-input">
            <option value="">Herdar da equipe</option>
            {perfis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>

        <fieldset className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" name="elegHome" defaultChecked={c?.elegHome ?? true} /> Elegível a home office
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" name="elegExterno" defaultChecked={c?.elegExterno ?? false} /> Elegível a trabalho externo
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" name="sextaReduzida" defaultChecked={c?.sextaReduzida ?? false} /> Sexta reduzida (−1h, só 5x2)
          </label>
        </fieldset>

        <label className="block">
          <span className="esc-rotulo">Admissão</span>
          <input type="date" name="admissao" defaultValue={c?.admissao} required className="esc-input" />
        </label>
        <SituacaoColaborador
          statusInicial={c?.status ?? 'ativo'}
          motivoInicial={c?.motivoStatus ?? ''}
          desligamentoInicial={c?.desligamento ?? ''}
        />

        <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3">
          <button type="submit" className="esc-btn">Salvar colaborador</button>
        </div>
      </form>
    </Bloco>
  );
}
