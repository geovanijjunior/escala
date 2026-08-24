import { redirect } from 'next/navigation';
import { getSessao, podeCadastrar } from '@/lib/sessao';
import { createClient } from '@/lib/supabase/server';
import { ROTULO_PAPEL } from '@/lib/supabase/types';
import { mudarPapel, alternarBloqueio } from '@/app/actions-usuarios';
import { Aviso, Badge, Bloco, Pill } from '@/components/Ui';
import { FormNovoUsuario } from '@/components/FormNovoUsuario';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

const PAPEIS: { valor: PapelEscalas; label: string; desc: string }[] = [
  { valor: 'planejamento', label: 'Planejamento', desc: 'Configura, gera e publica a escala; faz a triagem das solicitações.' },
  { valor: 'gestor', label: 'Gestor', desc: 'Acompanha e aprova apenas as equipes que gerencia.' },
  { valor: 'colaborador', label: 'Colaborador', desc: 'Consulta a própria escala e abre solicitações.' },
];

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string; criado?: string; senha?: string }>;
}) {
  const sessao = await getSessao();
  if (!podeCadastrar(sessao.papel)) redirect('/');

  const { erro, ok, criado, senha } = await searchParams;
  const supabase = await createClient();

  // Equipes e unidades alimentam os campos de escala que aparecem quando o
  // papel escolhido é colaborador.
  const [perfisRes, equipesRes, unidadesRes, semAcessoRes] = await Promise.all([
    supabase.from('perfis').select('id, nome, email, papel, bloqueado, criado_em').order('nome'),
    supabase.from('equipes').select('id, nome, regime').order('nome'),
    supabase.from('unidades').select('id, nome').eq('ativa', true).order('ordem'),
    // Quem já está na escala e ainda não tem login. É a lista que resolve o
    // caso de quem cadastrou o colaborador primeiro: sem ela, dar acesso a
    // essa pessoa exigia criar um segundo cadastro, que o banco recusa.
    supabase
      .from('colaboradores')
      .select('id, nome, matricula')
      .is('perfil_id', null)
      .eq('status', 'ativo')
      .order('nome'),
  ]);

  const usuarios = (perfisRes.data ?? []) as {
    id: string; nome: string; email: string; papel: PapelEscalas; bloqueado: boolean; criado_em: string;
  }[];
  const equipes = (equipesRes.data ?? []) as { id: number; nome: string; regime: string }[];
  const unidades = (unidadesRes.data ?? []) as { id: number; nome: string }[];
  const semAcesso = (semAcessoRes.data ?? []) as { id: number; nome: string; matricula: string }[];

  return (
    <>
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Usuários</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          Quem entra no sistema e com qual papel — {sessao.conta.nome}
        </p>
      </div>

      <Aviso erro={erro} ok={ok} />

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

      <Bloco
        titulo={`${usuarios.length} usuário(s)`}
        desc="O papel é a única dimensão de permissão do sistema, e vale no banco: um gestor não consegue ler os dados de outra equipe nem pela API."
      >
        <div className="overflow-x-auto">
          <table className="esc-tabela">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papel</th>
                <th>Situação</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">
                      {u.nome}
                      {u.id === sessao.usuario.id && (
                        <span className="ml-1.5" style={{ color: 'var(--muted)', fontWeight: 400 }}>(você)</span>
                      )}
                    </div>
                    <div className="text-[10.5px] font-mono" style={{ color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td>
                    {/* Quem responde pela área é nomeado pelo Administrador
                        Geral. Sem esta exceção o papel dele apareceria numa
                        lista que não o contém — o <select> cairia na primeira
                        opção e um "Salvar" distraído tentaria rebaixá-lo. A
                        ação recusaria, mas o convite não deveria existir. */}
                    {u.id === sessao.usuario.id || u.papel === 'admin_local' ? (
                      <Badge cor="var(--brand-700)" bg="var(--brand-100)">{ROTULO_PAPEL[u.papel]}</Badge>
                    ) : (
                      <form action={mudarPapel} className="flex items-center gap-1.5">
                        <input type="hidden" name="usuarioId" value={u.id} />
                        <select name="papel" defaultValue={u.papel} className="esc-input w-40 py-1">
                          {PAPEIS.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
                        </select>
                        <button type="submit" className="esc-btn esc-btn-outline esc-btn-sm">Salvar</button>
                      </form>
                    )}
                  </td>
                  <td>
                    {u.bloqueado
                      ? <Pill cor="var(--rose)" bg="var(--rose-bg)">Bloqueado</Pill>
                      : <Pill cor="var(--green)" bg="var(--green-bg)">Ativo</Pill>}
                  </td>
                  <td className="text-right">
                    {u.id !== sessao.usuario.id
                      && !(u.papel === 'admin_local' && sessao.papel !== 'admin_local') && (
                      <form action={alternarBloqueio} className="inline">
                        <input type="hidden" name="usuarioId" value={u.id} />
                        <button type="submit" className="esc-btn esc-btn-ghost esc-btn-sm">
                          {u.bloqueado ? 'Liberar' : 'Bloquear'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>

      <Bloco
        titulo="Adicionar pessoa"
        desc="Cria o login já dentro desta organização. A senha temporária é gerada automaticamente e mostrada uma única vez depois de salvar."
      >
        <FormNovoUsuario papeis={PAPEIS} equipes={equipes} unidades={unidades} semAcesso={semAcesso} />

        <ul className="px-4 pb-4 space-y-1.5">
          {PAPEIS.map(p => (
            <li key={p.valor} className="text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{p.label}</strong> — {p.desc}
            </li>
          ))}
        </ul>
      </Bloco>

      <Bloco titulo="Quem já está na escala" desc="Para ligar um login a um cadastro que já existe.">
        <p className="px-4 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          Criar o acesso de um colaborador aqui já monta o cadastro dele na escala. O caminho por{' '}
          <strong style={{ color: 'var(--text)' }}>Colaboradores</strong> continua existindo para o caso inverso — a
          pessoa já estava na escala (veio de uma planilha importada, por exemplo) e só agora vai ganhar login: lá,
          o campo <em>Usuário do sistema</em> liga os dois. É esse vínculo que faz &ldquo;Minha escala&rdquo; mostrar
          os dias certos e que permite ao gestor ver a própria equipe.
        </p>
      </Bloco>
    </>
  );
}
