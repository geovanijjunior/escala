import { getSessaoGeral } from '@/lib/sessao';
import { listarAreas, rotuloPapel } from '@/lib/data/areas';
import { competenciaDe, formatarCompetencia } from '@/lib/domain/escalas/datas';
import { Aviso, Bloco, Faixa, Pill, Stat, Vazio } from '@/components/Ui';
import {
  adicionarAdminLocal, alternarAdminLocal, alternarArea, criarArea, renomearArea,
} from '@/app/actions-areas';

/**
 * O console do Administrador Geral.
 *
 * Ele administra instâncias e acessos: cria a área, nomeia quem responde por
 * ela, vê quem tem login nela e a tira do ar quando acaba. Área não se apaga —
 * o histórico de meses fechados é registro trabalhista, então desativar tira do
 * ar e preserva.
 *
 * O que ele NÃO vê continua sendo o desenho: escala, solicitação, comunicado e
 * a ficha do colaborador (matrícula, cargo, jornada) não passam por aqui, e não
 * por escolha de interface — `perfis.conta_id` dele é nulo, e toda policy do
 * domínio compara `conta_id = conta_id()`, então o banco recusa antes.
 *
 * A lista de usuários é a exceção deliberada da migration 0016: quem responde
 * pelo sistema precisa saber quem entra nele. Ver, e só isso — alterar esses
 * usuários continua sendo do administrador da área.
 */
export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string; criado?: string; senha?: string }>;
}) {
  await getSessaoGeral();
  const { erro, ok, criado, senha } = await searchParams;

  const areas = await listarAreas();
  const agora = new Date();
  const competencia = competenciaDe(agora.getFullYear(), agora.getMonth());

  const ativas = areas.filter(a => a.ativa);
  const colaboradores = ativas.reduce((n, a) => n + a.colaboradores, 0);
  const semAdmin = ativas.filter(a => a.admins.length === 0).length;
  const semEscala = ativas.filter(a => a.competenciaPublicada !== competencia).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Áreas</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Cada área é uma instância isolada do Jornada — colaboradores, escalas e solicitações próprios
          </p>
        </div>
        <span className="text-[11.5px] esc-num" style={{ color: 'var(--faint)' }}>
          Competência de referência: {formatarCompetencia(competencia)}
        </span>
      </div>

      <Aviso erro={erro} ok={ok ? 'Alteração salva.' : undefined} />

      {criado && senha && (
        <div
          className="esc-card px-4 py-3.5"
          style={{ borderLeft: '3px solid var(--green)', background: 'var(--green-bg)' }}
        >
          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--green)' }}>
            Acesso criado. Entregue estes dados à pessoa — a senha não fica gravada e não será mostrada de novo.
          </p>
          <div className="mt-2.5 rounded-md px-3 py-2.5" style={{ background: 'var(--surface)' }}>
            <div className="flex justify-between gap-4 text-[13px] py-0.5">
              <span style={{ color: 'var(--muted)' }}>E-mail</span>
              <span className="font-mono font-semibold">{criado}</span>
            </div>
            <div className="flex justify-between gap-4 text-[13px] py-0.5">
              <span style={{ color: 'var(--muted)' }}>Senha temporária</span>
              <span className="font-mono font-semibold">{senha}</span>
            </div>
          </div>
        </div>
      )}

      <Faixa n={1}>O sistema hoje</Faixa>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Áreas ativas"
          valor={ativas.length}
          sub={areas.length > ativas.length ? `${areas.length - ativas.length} desativada(s)` : 'Nenhuma desativada'}
        />
        <Stat label="Colaboradores" valor={colaboradores} sub="Somados em todas as áreas ativas" />
        <Stat
          label="Sem administrador"
          valor={semAdmin}
          sub={semAdmin ? 'Ninguém consegue configurar essas áreas' : 'Toda área tem quem responda por ela'}
          cor="var(--rose)"
          alerta={semAdmin > 0}
        />
        <Stat
          label="Mês não publicado"
          valor={semEscala}
          sub={`Áreas ativas sem escala publicada em ${formatarCompetencia(competencia)}`}
          cor="var(--amber)"
          alerta={semEscala > 0}
        />
      </div>

      <Faixa n={2}>Áreas cadastradas</Faixa>

      {areas.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Nenhuma área cadastrada"
            desc="Cadastre a primeira área abaixo. Ela nasce junto com o administrador responsável, porque uma área sem administrador é uma instância que ninguém consegue abrir."
          />
        </Bloco>
      ) : (
        <div className="space-y-3.5">
          {areas.map(area => (
            <Bloco key={area.id}>
              <div className="esc-bloco-topo">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="esc-titulo">{area.nome}</h3>
                    {area.ativa
                      ? <Pill cor="var(--green)" bg="var(--green-bg)">Ativa</Pill>
                      : <Pill cor="var(--rose)" bg="var(--rose-bg)">Desativada</Pill>}
                    {area.admins.length === 0 && (
                      <Pill cor="var(--rose)" bg="var(--rose-bg)">Sem administrador</Pill>
                    )}
                  </div>
                  <p className="esc-desc">
                    {area.colaboradores} colaborador(es) · {area.usuarios.length} usuário(s) ·{' '}
                    {area.competenciaPublicada
                      ? `última escala publicada em ${formatarCompetencia(area.competenciaPublicada)}`
                      : 'nenhuma escala publicada'}
                  </p>
                </div>
                <form action={alternarArea} className="shrink-0">
                  <input type="hidden" name="areaId" value={area.id} />
                  <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">
                    {area.ativa ? 'Desativar' : 'Reativar'}
                  </button>
                </form>
              </div>

              <div className="px-4 py-3.5 space-y-3">
                {area.admins.length > 0 && (
                  <ul className="space-y-1.5">
                    {area.admins.map(a => (
                      <li key={a.id} className="flex items-center gap-2.5 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium">{a.nome}</div>
                          <div className="text-[10.5px] font-mono" style={{ color: 'var(--muted)' }}>{a.email}</div>
                        </div>
                        {a.bloqueado && <Pill cor="var(--rose)" bg="var(--rose-bg)">Bloqueado</Pill>}
                        <form action={alternarAdminLocal} className="ml-auto">
                          <input type="hidden" name="usuarioId" value={a.id} />
                          <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">
                            {a.bloqueado ? 'Liberar' : 'Bloquear'}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                {/* A lista completa fica atrás de um clique de propósito: numa
                    instalação com muitas áreas, todas abertas ao mesmo tempo
                    empurrariam para fora da tela justamente o que a página
                    existe para comparar — o estado de cada área. */}
                {area.usuarios.length > 0 && (
                  <details>
                    <summary className="text-[12px] font-semibold cursor-pointer" style={{ color: 'var(--accent)' }}>
                      Ver os {area.usuarios.length} usuário(s) desta área
                    </summary>

                    <div className="mt-2.5 rounded-md overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr style={{ background: 'var(--bg)' }}>
                            <th className="text-left font-semibold px-3 py-1.5">Nome</th>
                            <th className="text-left font-semibold px-3 py-1.5">E-mail</th>
                            <th className="text-left font-semibold px-3 py-1.5">Papel</th>
                            <th className="text-left font-semibold px-3 py-1.5">Acesso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {area.usuarios.map(u => (
                            <tr key={u.id} style={{ borderTop: '1px solid var(--line)' }}>
                              <td className="px-3 py-1.5">{u.nome}</td>
                              <td className="px-3 py-1.5 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                                {u.email}
                              </td>
                              <td className="px-3 py-1.5">{rotuloPapel(u.papel)}</td>
                              <td className="px-3 py-1.5">
                                {u.bloqueado
                                  ? <span style={{ color: 'var(--rose)' }}>Bloqueado</span>
                                  : <span style={{ color: 'var(--muted)' }}>Ativo</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
                      Esta lista é só de leitura. Quem cria, bloqueia e troca o papel dos usuários de uma área é o
                      Administrador da Área — exceto os próprios administradores, que são nomeados aqui.
                    </p>
                  </details>
                )}

                {/* `<details>` porque as duas ações são raras: renomear e somar
                    um administrador acontecem uma vez na vida da área. Abertas
                    o tempo todo, transformariam a lista de áreas num formulário
                    empilhado onde não se lê mais nada. */}
                <details className="group">
                  <summary className="text-[12px] font-semibold cursor-pointer" style={{ color: 'var(--accent)' }}>
                    Administrar esta área
                  </summary>

                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <form action={renomearArea} className="space-y-2">
                      <input type="hidden" name="areaId" value={area.id} />
                      <label className="block">
                        <span className="esc-rotulo">Nome da área</span>
                        <input name="nome" defaultValue={area.nome} required className="esc-input" />
                      </label>
                      <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Renomear</button>
                    </form>

                    <form action={adicionarAdminLocal} className="space-y-2">
                      <input type="hidden" name="areaId" value={area.id} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="esc-rotulo">Novo administrador</span>
                          <input name="adminNome" required className="esc-input" />
                        </label>
                        <label className="block">
                          <span className="esc-rotulo">E-mail</span>
                          <input type="email" name="adminEmail" required className="esc-input" />
                        </label>
                      </div>
                      <label className="block">
                        <span className="esc-rotulo">Senha temporária</span>
                        <input name="senha" className="esc-input" placeholder="Gerada automaticamente" />
                      </label>
                      <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">
                        Adicionar administrador
                      </button>
                    </form>
                  </div>
                </details>
              </div>
            </Bloco>
          ))}
        </div>
      )}

      <Faixa n={3}>Nova área</Faixa>
      <Bloco
        titulo="Cadastrar área e seu administrador"
        desc="Os dois no mesmo passo: se o login falhar, a área não chega a existir. Quem entrar com este acesso cadastra o Planejamento da área, e o Planejamento monta a operação."
      >
        <form action={criarArea} className="px-4 py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="esc-rotulo">Nome da área</span>
            <input name="nome" required className="esc-input" placeholder="Hospital São Lucas" />
          </label>
          <label className="block">
            <span className="esc-rotulo">Administrador</span>
            <input name="adminNome" required className="esc-input" />
          </label>
          <label className="block">
            <span className="esc-rotulo">E-mail</span>
            <input type="email" name="adminEmail" required className="esc-input" />
          </label>
          <label className="block">
            <span className="esc-rotulo">Senha temporária</span>
            <input name="senha" className="esc-input" placeholder="Gerada automaticamente" />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="esc-btn">Criar área</button>
          </div>
        </form>

        <ul className="px-4 pb-4 space-y-1.5">
          <li className="text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Administrador Geral</strong> — cadastra as áreas e quem responde
            por cada uma, e vê quem tem login em cada área. Não enxerga a ficha do colaborador, a escala nem as
            solicitações de área nenhuma.
          </li>
          <li className="text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Administrador da Área</strong> — cadastra o Planejamento e cuida
            de colaboradores, equipes, unidades e parâmetros. Não monta plano nem gera escala.
          </li>
          <li className="text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Planejamento</strong> — daqui para baixo a hierarquia é a de
            sempre: monta o plano do mês, gera e publica a escala, faz a triagem das solicitações.
          </li>
        </ul>
      </Bloco>
    </>
  );
}
