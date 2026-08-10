import Link from 'next/link';
import { entrar } from '@/app/actions-sessao';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-6">
          <div
            className="w-9 h-9 rounded-lg grid place-items-center text-[11px] font-bold text-white"
            style={{ background: 'var(--brand-900)' }}
            aria-hidden
          >
            ESC
          </div>
          <div className="leading-tight">
            <h1 className="text-[17px] font-semibold">Escala</h1>
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Gestão de escalas de trabalho
            </p>
          </div>
        </div>

        <div className="esc-card px-5 py-5">
          {erro && (
            <p
              className="mb-4 px-3 py-2 rounded-md text-[12.5px] font-medium"
              style={{ background: 'var(--rose-bg)', color: 'var(--rose)' }}
              role="alert"
            >
              {erro}
            </p>
          )}

          <form action={entrar} className="space-y-3.5">
            <label className="block">
              <span className="esc-rotulo">E-mail</span>
              <input type="email" name="email" required autoComplete="email" className="esc-input" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Senha</span>
              <input type="password" name="senha" required autoComplete="current-password" className="esc-input" />
            </label>
            <button type="submit" className="esc-btn w-full justify-center">
              Entrar
            </button>
          </form>
        </div>

        <p className="text-[12px] mt-4 text-center" style={{ color: 'var(--muted)' }}>
          Ainda não tem uma organização?{' '}
          <Link href="/cadastro" className="font-semibold" style={{ color: 'var(--brand-700)' }}>
            Criar agora
          </Link>
        </p>
      </div>
    </div>
  );
}
