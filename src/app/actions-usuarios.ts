'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rotaComErro } from '@/lib/volta';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessao, exigirCadastrador } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { mensagemErroAuth } from '@/lib/erros-auth';
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
 * Cria o login de alguém na organização.
 *
 * O usuário nasce direto no Supabase Auth com `conta_id` nos metadados — é isso
 * que faz o trigger handle_novo_usuario colocá-lo nesta conta em vez de criar
 * uma organização nova.
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

  const senha = String(formData.get('senha') ?? '').trim() || senhaTemporaria();
  if (senha.length < 8) erro('A senha temporária precisa ter ao menos 8 caracteres.');

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, papel, conta_id: sessao.conta.id, precisa_trocar_senha: true },
  });

  if (error) erro(mensagemErroAuth(error));

  await registrarLog(sessao, 'Usuário criado', `${nome} (${email}) · ${papel}`);
  revalidatePath(VOLTA);
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
