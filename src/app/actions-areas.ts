'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessaoGeral } from '@/lib/sessao';
import { mensagemErroAuth } from '@/lib/erros-auth';
import { rotaComErro } from '@/lib/volta';
import type { PerfilUsuario } from '@/lib/supabase/types';

const VOLTA = '/areas';

function erro(msg: string): never {
  redirect(rotaComErro(VOLTA, msg));
}

/** Sem ambiguidade visual: nada de O/0, I/l/1. */
function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('');
}

/**
 * Deixa registrado na área o que o Administrador Geral fez com ela.
 *
 * Não dá para usar `registrarLog`: `logs_insert` exige `conta_id = conta_id()`,
 * e quem faz isto não tem conta. Escrever pelo client de serviço é o caminho
 * certo — o alternativo seria abrir a policy para um papel que, por desenho,
 * não enxerga nada dentro da área. O rastro fica na área, que é onde o
 * Planejamento dela vai procurar quando estranhar a mudança.
 */
async function registrarNaArea(
  contaId: string, usuario: PerfilUsuario, acao: string, detalhe = '',
) {
  const admin = createAdminClient();
  await admin.from('logs').insert({
    conta_id: contaId,
    usuario_id: usuario.id,
    usuario_nome: `${usuario.nome} (Administrador Geral)`,
    acao,
    detalhe,
  });
}

function validarAdmin(nome: string, email: string, senha: string) {
  if (!nome) erro('Informe o nome do administrador da área.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erro('E-mail do administrador em formato inválido.');
  if (senha.length < 8) erro('A senha temporária precisa ter ao menos 8 caracteres.');
}

/**
 * Cria a área e, no mesmo passo, quem responde por ela.
 *
 * Os dois juntos e não em duas telas: uma área sem administrador é uma
 * instância que ninguém consegue abrir, e criá-la assim seria produzir
 * exatamente o estado que depois dá trabalho para descobrir. Se o login falhar,
 * a área recém-criada é desfeita — melhor não existir do que existir órfã.
 *
 * A conta é inserida pelo client normal, sob RLS: `contas_insert` exige
 * `eh_admin_geral()`, então a regra continua valendo no banco e não só aqui.
 * O login precisa do client de serviço porque criar usuário é operação de
 * administração do Auth — não existe versão dela sob RLS.
 */
export async function criarArea(formData: FormData) {
  const sessao = await getSessaoGeral();

  const nome = String(formData.get('nome') ?? '').trim();
  const adminNome = String(formData.get('adminNome') ?? '').trim();
  const adminEmail = String(formData.get('adminEmail') ?? '').trim().toLowerCase();
  const senha = String(formData.get('senha') ?? '').trim() || senhaTemporaria();

  if (!nome) erro('Informe o nome da área.');
  validarAdmin(adminNome, adminEmail, senha);

  const supabase = await createClient();
  const { data: area, error: erroArea } = await supabase
    .from('contas')
    .insert({ nome })
    .select('id')
    .single();

  if (erroArea || !area) erro(`Não foi possível criar a área: ${erroArea?.message ?? 'motivo desconhecido'}`);

  const admin = createAdminClient();
  const { error: erroLogin } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: senha,
    email_confirm: true,
    // É o trigger `handle_novo_usuario` que lê estes campos e cria o perfil
    // dentro desta área com este papel.
    user_metadata: {
      nome: adminNome, papel: 'admin_local', conta_id: area.id, precisa_trocar_senha: true,
    },
  });

  if (erroLogin) {
    // Desfaz pelo client de serviço, e não pelo normal: não existe policy de
    // delete em `contas` — apagar uma área com histórico dentro seria destruir
    // registro trabalhista, então o banco recusa para todo mundo. Aqui o alvo é
    // uma área criada há dois segundos, ainda sem nada dentro, e o id não veio
    // do cliente: veio do `insert` desta mesma função.
    await admin.from('contas').delete().eq('id', area.id);
    erro(mensagemErroAuth(erroLogin));
  }

  await registrarNaArea(area.id, sessao.usuario, 'Área criada', `${nome} · administrador ${adminEmail}`);
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?criado=${encodeURIComponent(adminEmail)}&senha=${encodeURIComponent(senha)}`);
}

/** Mais um administrador para uma área que já existe — férias, sucessão, dupla. */
export async function adicionarAdminLocal(formData: FormData) {
  const sessao = await getSessaoGeral();

  const areaId = String(formData.get('areaId') ?? '');
  const nome = String(formData.get('adminNome') ?? '').trim();
  const email = String(formData.get('adminEmail') ?? '').trim().toLowerCase();
  const senha = String(formData.get('senha') ?? '').trim() || senhaTemporaria();

  if (!areaId) erro('Área não informada.');
  validarAdmin(nome, email, senha);

  // Confere que a área existe pelo client sob RLS: se um id forjado chegasse
  // aqui, o client de serviço criaria o login apontando para lugar nenhum.
  const supabase = await createClient();
  const { data: area } = await supabase.from('contas').select('id, nome').eq('id', areaId).maybeSingle();
  if (!area) erro('Área não encontrada.');

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, papel: 'admin_local', conta_id: areaId, precisa_trocar_senha: true },
  });
  if (error) erro(mensagemErroAuth(error));

  await registrarNaArea(areaId, sessao.usuario, 'Administrador da área adicionado', `${nome} (${email})`);
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?criado=${encodeURIComponent(email)}&senha=${encodeURIComponent(senha)}`);
}

export async function renomearArea(formData: FormData) {
  const sessao = await getSessaoGeral();

  const areaId = String(formData.get('areaId') ?? '');
  const nome = String(formData.get('nome') ?? '').trim();
  if (!areaId) erro('Área não informada.');
  if (!nome) erro('Informe o nome da área.');

  const supabase = await createClient();
  const { error } = await supabase.from('contas').update({ nome }).eq('id', areaId);
  if (error) erro(`Não foi possível renomear: ${error.message}`);

  await registrarNaArea(areaId, sessao.usuario, 'Área renomeada', nome);
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?ok=1`);
}

/**
 * Tira a área do ar sem apagá-la.
 *
 * Apagar levaria junto, em cascata, a escala inteira de uma operação —
 * inclusive o histórico de meses fechados, que é registro trabalhista. Por isso
 * não existe botão de excluir: desativar tira todo mundo de dentro e preserva o
 * que aconteceu.
 */
export async function alternarArea(formData: FormData) {
  const sessao = await getSessaoGeral();

  const areaId = String(formData.get('areaId') ?? '');
  if (!areaId) erro('Área não informada.');

  const supabase = await createClient();
  const { data: area } = await supabase.from('contas').select('nome, ativa').eq('id', areaId).maybeSingle();
  if (!area) erro('Área não encontrada.');

  const ativa = !area.ativa;
  const { error } = await supabase.from('contas').update({ ativa }).eq('id', areaId);
  if (error) erro(`Não foi possível ${ativa ? 'reativar' : 'desativar'} a área: ${error.message}`);

  await registrarNaArea(areaId, sessao.usuario, ativa ? 'Área reativada' : 'Área desativada', area.nome);
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?ok=1`);
}

/**
 * Bloqueia ou libera um administrador de área.
 *
 * Espelha `alternarBloqueio` de dentro da área, e pela mesma razão: a coluna
 * `bloqueado` sozinha seria um rótulo, já que um token ainda válido continuaria
 * falando com a API. O `ban_duration` do Auth é o que de fato fecha a porta.
 */
export async function alternarAdminLocal(formData: FormData) {
  const sessao = await getSessaoGeral();

  const usuarioId = String(formData.get('usuarioId') ?? '');
  if (!usuarioId) erro('Administrador não informado.');

  // Sob RLS o Geral só enxerga perfis `admin_local`, então esta leitura é a
  // própria checagem: se voltar vazia, o alvo não é um administrador de área.
  const supabase = await createClient();
  const { data: alvo } = await supabase
    .from('perfis')
    .select('id, nome, conta_id, bloqueado')
    .eq('id', usuarioId)
    .maybeSingle();
  if (!alvo) erro('Administrador não encontrado.');

  const bloqueado = !alvo.bloqueado;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(usuarioId, {
    ban_duration: bloqueado ? '876000h' : 'none', // ~100 anos = indefinido
  });
  if (error) erro(`Não foi possível ${bloqueado ? 'bloquear' : 'liberar'} o acesso: ${error.message}`);

  await supabase.from('perfis').update({ bloqueado }).eq('id', usuarioId);

  await registrarNaArea(
    alvo.conta_id as string, sessao.usuario,
    bloqueado ? 'Administrador da área bloqueado' : 'Administrador da área liberado', alvo.nome as string,
  );
  revalidatePath(VOLTA);
  redirect(`${VOLTA}?ok=1`);
}
