'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rotaComErro } from '@/lib/volta';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessao, exigirCadastrador } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { mensagemErroAuth } from '@/lib/erros-auth';
import { mensagemErroBanco } from '@/lib/erros-banco';
import { montarColaborador } from '@/lib/colaborador-form';
import { voltar } from '@/lib/volta';
import type { PapelEscalas } from '@/lib/domain/escalas/tipos';

const VOLTA = '/usuarios';

function erro(msg: string): never {
  redirect(rotaComErro(VOLTA, msg));
}

/**
 * Os papéis que se concedem de dentro da área.
 *
 * `admin_local` não está aqui: quem responde pela área é nomeado pelo
 * Administrador Geral, e deixar a própria área promover um administrador
 * transformaria o Planejamento em administrador com um clique. A RLS
 * (`perfis_insert`/`perfis_update`) recusa o mesmo, então esconder da lista é
 * conveniência, não a trava.
 */
const PAPEIS: PapelEscalas[] = ['planejamento', 'gestor', 'colaborador'];

/** Sem ambiguidade visual: nada de O/0, I/l/1. */
function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('');
}

/**
 * Cria o login de alguém na organização — e, se for colaborador, o cadastro
 * dele na escala no mesmo passo.
 *
 * O usuário nasce direto no Supabase Auth com `conta_id` nos metadados — é isso
 * que faz o trigger handle_novo_usuario colocá-lo nesta conta em vez de criar
 * uma organização nova.
 *
 * A ordem das quatro etapas abaixo não é arbitrária, e o motivo é que criar
 * login e criar colaborador acontecem em sistemas diferentes — Auth e banco —
 * sem uma transação que abrace os dois:
 *
 *   1. valida o colaborador ANTES de tocar no Auth. Matrícula repetida ou
 *      equipe faltando são os erros comuns, e descobri-los depois deixaria um
 *      login criado que a pessoa não pediu;
 *   2. cria o login;
 *   3. grava o colaborador já apontando para o perfil recém-criado. O perfil
 *      existe porque o trigger roda dentro da transação do insert em
 *      `auth.users`, então quando `createUser` retorna ele já está lá;
 *   4. se o passo 3 falhar mesmo assim, desfaz o login. Um login sem
 *      colaborador entra no sistema e não aparece em escala nenhuma — some
 *      dentro da lista de usuários e só reaparece quando alguém estranha.
 *
 * A senha temporária é devolvida na query string uma única vez, para ser
 * entregue à pessoa. Ela não fica gravada em lugar nenhum.
 */
export async function convidarUsuario(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, VOLTA);

  const nome = String(formData.get('nome') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const papelBruto = String(formData.get('papel') ?? '');
  const papel = (PAPEIS as string[]).includes(papelBruto) ? (papelBruto as PapelEscalas) : 'colaborador';

  if (!nome) erro('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erro('E-mail em formato inválido.');

  // Sempre gerada: o formulário não tem mais campo de senha. Aceitar um valor
  // digitado convidava a repetir a mesma senha para todo mundo, e o que viesse
  // do formulário ainda daria a volta pela query string.
  const senha = senhaTemporaria();

  // 1. O colaborador é validado primeiro, com `perfilId` ainda nulo — o id só
  //    existe depois do passo 2, e é preenchido na hora de gravar.
  const supabase = await createClient();
  const dados = papel === 'colaborador'
    ? await montarColaborador(supabase, sessao.conta.id, formData, { perfilId: null, nome, email })
    : null;
  if (dados && !dados.ok) erro(dados.erro);

  // 2. O login.
  const admin = createAdminClient();
  const { data: criado, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, papel, conta_id: sessao.conta.id, precisa_trocar_senha: true },
  });

  if (error || !criado?.user) erro(mensagemErroAuth(error));

  // 3. O colaborador, apontando para o perfil que o trigger acabou de criar.
  if (dados?.ok) {
    const { error: erroColab } = await supabase
      .from('colaboradores')
      .insert({ ...dados.registro, perfil_id: criado.user.id });

    // 4. Não deu: o login volta atrás para não sobrar acesso órfão.
    if (erroColab) {
      await admin.auth.admin.deleteUser(criado.user.id);
      erro(`O acesso não foi criado porque o cadastro na escala falhou: ${mensagemErroBanco(erroColab)}`);
    }
  }

  await registrarLog(
    sessao,
    'Usuário criado',
    `${nome} (${email}) · ${papel}${dados?.ok ? ` · colaborador ${dados.registro.matricula}` : ''}`,
  );
  revalidatePath('/', 'layout');
  redirect(`${VOLTA}?criado=${encodeURIComponent(email)}&senha=${encodeURIComponent(senha)}`);
}

export async function mudarPapel(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, VOLTA);

  const usuarioId = String(formData.get('usuarioId') ?? '');
  const papelBruto = String(formData.get('papel') ?? '');
  if (!(PAPEIS as string[]).includes(papelBruto)) erro('Papel inválido.');

  // Trocar o próprio papel só tem um destino possível: para baixo. E rebaixar
  // a si mesmo pode deixar a área sem ninguém capaz de configurá-la — o
  // Administrador da Área, se virasse Planejamento, precisaria do Administrador
  // Geral para voltar atrás.
  if (usuarioId === sessao.usuario.id) {
    erro('Você não pode alterar o próprio papel. Peça a outra pessoa com acesso de administração.');
  }

  const supabase = await createClient();
  const { data: alvo } = await supabase.from('perfis').select('nome, papel').eq('id', usuarioId).single();

  // O Planejamento não rebaixa quem responde pela área.
  if (alvo?.papel === 'admin_local') {
    erro('O Administrador da Área é definido pelo Administrador Geral.');
  }
  await supabase.from('perfis').update({ papel: papelBruto }).eq('id', usuarioId);

  await registrarLog(sessao, 'Papel alterado', `${alvo?.nome ?? usuarioId} → ${papelBruto}`);
  revalidatePath(VOLTA);
  voltar(VOLTA, formData);
}

/**
 * Bloqueia o acesso de verdade, não só na tela de login.
 *
 * A coluna `perfis.bloqueado` sozinha seria um rótulo: quem já tem um token
 * válido continuaria falando com a API REST do Supabase direto. O `ban_duration`
 * do próprio Auth invalida a sessão e recusa novos logins; a coluna existe para
 * a interface conseguir mostrar o estado sem consultar a API de admin.
 */
export async function alternarBloqueio(formData: FormData) {
  const sessao = await getSessao();
  exigirCadastrador(sessao.papel, VOLTA);

  const usuarioId = String(formData.get('usuarioId') ?? '');
  if (usuarioId === sessao.usuario.id) erro('Você não pode bloquear o próprio acesso.');

  const supabase = await createClient();
  const { data: alvo } = await supabase.from('perfis').select('nome, papel, bloqueado').eq('id', usuarioId).single();
  if (!alvo) erro('Usuário não encontrado.');

  // Sem isto, o Planejamento tranca do lado de fora quem responde pela área.
  if (alvo.papel === 'admin_local' && sessao.papel !== 'admin_local') {
    erro('Só o Administrador Geral bloqueia o Administrador da Área.');
  }

  const bloqueado = !alvo.bloqueado;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(usuarioId, {
    ban_duration: bloqueado ? '876000h' : 'none', // ~100 anos = indefinido
  });
  if (error) erro(`Não foi possível ${bloqueado ? 'bloquear' : 'liberar'} o acesso: ${error.message}`);

  await supabase.from('perfis').update({ bloqueado }).eq('id', usuarioId);

  await registrarLog(sessao, bloqueado ? 'Acesso bloqueado' : 'Acesso liberado', alvo.nome);
  revalidatePath(VOLTA);
  voltar(VOLTA, formData);
}
