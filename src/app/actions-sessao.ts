'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mensagemErroAuth } from '@/lib/erros-auth';

export async function entrar(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  if (!email || !senha) redirect('/login?erro=' + encodeURIComponent('Informe e-mail e senha.'));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  // Credencial errada tem mensagem única para e-mail inexistente e senha errada:
  // dizer qual dos dois falhou entrega a quem tenta adivinhar quais e-mails
  // existem na base. Erros de configuração e de limite não têm esse risco e
  // precisam aparecer como são, ou viram "senha errada" e ninguém acha a causa.
  if (error || !data.user) {
    const credencialInvalida = !error || error.code === 'invalid_credentials'
      || /invalid login credentials/i.test(error.message ?? '');
    const msg = credencialInvalida ? 'E-mail ou senha incorretos.' : mensagemErroAuth(error);
    redirect('/login?erro=' + encodeURIComponent(msg));
  }

  const { data: perfil } = await supabase
    .from('perfis')
    .select('bloqueado, papel')
    .eq('id', data.user.id)
    .single();
  if (!perfil) {
    await supabase.auth.signOut();
    redirect('/login?erro=' + encodeURIComponent('Seu usuário não está vinculado a nenhuma organização.'));
  }
  if (perfil.bloqueado) {
    await supabase.auth.signOut();
    redirect('/login?erro=' + encodeURIComponent('Seu acesso está bloqueado. Fale com o Planejamento.'));
  }

  // O Administrador Geral não pertence a área nenhuma, e "/" é o console de uma
  // área. Mandá-lo direto para o dele evita um salto pelo login.
  if (perfil.papel === 'admin_geral') redirect('/areas');

  // Área desativada fecha a porta para todo mundo que está dentro dela,
  // inclusive o administrador local. Barrar aqui, e não só nas telas, impede a
  // sessão de nascer — sem isto o login daria certo e a pessoa só descobriria o
  // problema ao ser devolvida ao login pela tela seguinte, sem explicação.
  const { data: conta } = await supabase.from('contas').select('ativa').maybeSingle();
  if (conta && conta.ativa === false) {
    await supabase.auth.signOut();
    redirect('/login?erro=' + encodeURIComponent('Esta área está desativada. Fale com o administrador do sistema.'));
  }

  redirect('/');
}

/*
 * Não há `cadastrar()`.
 *
 * Todo acesso ao Jornada é concedido por alguém acima na corrente — o
 * Administrador Geral cria a área e o Administrador dela, que cadastra o
 * Planejamento, que cadastra gestores e colaboradores. O auto-cadastro criava
 * uma organização inteira para quem chegasse na URL, o que contradiz essa
 * corrente; a tela e a action foram removidas juntas, porque tirar só o link
 * deixaria a porta aberta para quem soubesse o endereço.
 *
 * O trigger `handle_novo_usuario` continua tratando o signup sem `conta_id` —
 * ele é a última linha de defesa se alguém chamar a API de Auth por fora, e não
 * o caminho de ninguém pela interface.
 */

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
