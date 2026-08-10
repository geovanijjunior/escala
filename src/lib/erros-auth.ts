/**
 * Traduz os erros do Supabase Auth para português, dizendo o que fazer.
 *
 * As mensagens originais chegam em inglês e algumas são francamente ruins — o
 * limite de envio de e-mail, por exemplo, se anuncia como "you can only request
 * this after 0 seconds", que além de não estar em português diz um tempo que
 * não é verdade. Repassar isso para a tela transfere o problema ao usuário.
 *
 * Casamos primeiro por `code`, que é estável, e só caímos no texto quando o
 * código não vem (versões antigas do GoTrue e alguns caminhos de erro).
 */

const POR_CODIGO: Record<string, string> = {
  over_email_send_rate_limit:
    'Limite de envio de e-mails atingido. O Supabase permite poucos e-mails por hora no plano gratuito. Desative "Confirm email" em Authentication → Sign In / Providers → Email: este sistema não depende de confirmação por e-mail.',
  over_request_rate_limit:
    'Muitas tentativas seguidas. Espere alguns minutos antes de tentar de novo.',
  user_already_exists: 'Já existe uma conta com este e-mail. Use "Entrar".',
  email_exists: 'Já existe uma conta com este e-mail. Use "Entrar".',
  signup_disabled: 'O cadastro está desativado neste projeto do Supabase.',
  email_address_invalid: 'E-mail em formato inválido.',
  email_address_not_authorized: 'Este e-mail não está autorizado a se cadastrar neste projeto.',
  weak_password: 'Senha fraca demais. Use ao menos 8 caracteres, misturando letras e números.',
  email_not_confirmed:
    'E-mail ainda não confirmado. Desative "Confirm email" em Authentication → Sign In / Providers → Email.',
  user_banned: 'Seu acesso está bloqueado. Fale com o Planejamento.',
};

const POR_TEXTO: [RegExp, string][] = [
  [/you can only request this after/i, POR_CODIGO.over_email_send_rate_limit],
  [/email rate limit exceeded/i, POR_CODIGO.over_email_send_rate_limit],
  [/rate limit/i, POR_CODIGO.over_request_rate_limit],
  [/user already registered|already been registered/i, POR_CODIGO.user_already_exists],
  [/signups? not allowed/i, POR_CODIGO.signup_disabled],
  [/invalid format|unable to validate email/i, POR_CODIGO.email_address_invalid],
  [/password should be at least/i, POR_CODIGO.weak_password],
  [/email not confirmed/i, POR_CODIGO.email_not_confirmed],
  [/user is banned/i, POR_CODIGO.user_banned],
  [
    /database error|relation .* does not exist|function .* does not exist/i,
    'O banco não está preparado. Rode as migrações de supabase/migrations no SQL Editor, na ordem 0001 e depois 0002.',
  ],
  [
    /fetch failed|network|ENOTFOUND|ECONNREFUSED/i,
    'Não foi possível falar com o Supabase. Confira NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  ],
  [/invalid api key|no api key/i, 'Chave do Supabase inválida. Confira NEXT_PUBLIC_SUPABASE_ANON_KEY.'],
];

/** Aceita o erro do supabase-js, ou qualquer coisa com `code`/`message`. */
export function mensagemErroAuth(erro: { code?: string; message?: string } | null | undefined): string {
  if (!erro) return 'Não foi possível concluir. Tente de novo.';

  if (erro.code && POR_CODIGO[erro.code]) return POR_CODIGO[erro.code];

  const texto = erro.message ?? '';
  for (const [padrao, traducao] of POR_TEXTO) {
    if (padrao.test(texto)) return traducao;
  }

  // Última linha: mostrar o original é melhor que engolir o erro, mas avisamos
  // que veio de fora para o usuário não procurar esse texto na nossa interface.
  return texto ? `Erro do Supabase: ${texto}` : 'Não foi possível concluir. Tente de novo.';
}
