import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Acessíveis sem sessão. /redefinir-senha precisa ficar de fora do bloqueio:
// quem chega ali vem de um link de e-mail, e a sessão de recuperação só é
// processada pelo JavaScript do navegador — barrar no servidor antes disso
// rodar impediria a página de sequer carregar.
const ROTAS_PUBLICAS = ['/login', '/cadastro', '/redefinir-senha'];

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

  if (ROTAS_PUBLICAS.some(r => pathname.startsWith(r))) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
