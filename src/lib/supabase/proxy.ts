import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Acessíveis sem sessão. /redefinir-senha precisa ficar de fora do bloqueio:
// quem chega ali vem de um link de e-mail, e a sessão de recuperação só é
// processada pelo JavaScript do navegador — barrar no servidor antes disso
// rodar impediria a página de sequer carregar.
const ROTAS_PUBLICAS = ['/login', '/redefinir-senha'];

/**
 * Casa a rota exata ou um filho dela (`/login/ajuda`), nunca um prefixo solto.
 *
 * Com `startsWith` puro, qualquer caminho começando com o texto ficava público:
 * uma tela futura chamada `/cadastro-relatorios` ou `/loginhistorico` seria
 * servida sem sessão, e nada no código avisaria. Nenhuma rota assim existe
 * hoje, então não havia brecha aberta — é a armadilha que dispara meses depois,
 * quando alguém escolhe um nome inocente.
 */
function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some(r => pathname === r || pathname.startsWith(`${r}/`));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (ehPublica(pathname)) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
