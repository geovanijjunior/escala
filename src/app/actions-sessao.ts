'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function entrar(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  if (!email || !senha) redirect('/login?erro=' + encodeURIComponent('Informe e-mail e senha.'));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  // Mensagem única para e-mail inexistente e senha errada: dizer qual dos dois
  // falhou entrega a quem tenta adivinhar quais e-mails existem na base.
  if (error || !data.user) redirect('/login?erro=' + encodeURIComponent('E-mail ou senha incorretos.'));

  const { data: perfil } = await supabase.from('perfis').select('bloqueado').eq('id', data.user.id).single();
  if (!perfil) {
    await supabase.auth.signOut();
    redirect('/login?erro=' + encodeURIComponent('Seu usuário não está vinculado a nenhuma organização.'));
  }
  if (perfil.bloqueado) {
    await supabase.auth.signOut();
    redirect('/login?erro=' + encodeURIComponent('Seu acesso está bloqueado. Fale com o Planejamento.'));
  }

  redirect('/');
}

/**
 * Cria uma organização nova. Quem cadastra entra como Planejamento — é quem
 * está montando a operação. Os demais entram por convite (Colaboradores).
 */
export async function cadastrar(formData: FormData) {
  const nome = String(formData.get('nome') ?? '').trim();
  const organizacao = String(formData.get('organizacao') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');

  const volta = (msg: string) => redirect('/cadastro?erro=' + encodeURIComponent(msg));
  if (!nome) volta('Informe seu nome.');
  if (!organizacao) volta('Informe o nome da organização.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) volta('E-mail em formato inválido.');
  if (senha.length < 8) volta('A senha precisa ter ao menos 8 caracteres.');

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password: senha,
    // O trigger handle_novo_usuario lê estes campos para criar a conta.
    options: { data: { nome, organizacao } },
  });

  if (error) volta(error.message);
  redirect('/');
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
