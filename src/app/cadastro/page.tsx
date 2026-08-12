import Link from 'next/link';
import { cadastrar } from '@/app/actions-sessao';
import { Simbolo } from '@/components/Marca';

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-3 mb-6">
          <Simbolo tamanho={44} />
          <div className="leading-tight">
            <h1 className="text-[19px] font-bold" style={{ letterSpacing: '-.025em' }}>Criar organização</h1>
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Você entra como Planejamento e convida o resto do time depois
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

          <form action={cadastrar} className="space-y-3.5">
            <label className="block">
              <span className="esc-rotulo">Organização</span>
              <input name="organizacao" required className="esc-input" placeholder="Ex.: Suporte TI Hospitalar" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Seu nome</span>
              <input name="nome" required autoComplete="name" className="esc-input" />
            </label>
            <label className="block">
              <span className="esc-rotulo">E-mail</span>
              <input type="email" name="email" required autoComplete="email" className="esc-input" />
            </label>
            <label className="block">
              <span className="esc-rotulo">Senha</span>
              <input
                type="password"
                name="senha"
                required
                minLength={8}
                autoComplete="new-password"
                className="esc-input"
              />
              <span className="esc-ajuda mt-1 block">Ao menos 8 caracteres.</span>
            </label>
            <button type="submit" className="esc-btn w-full justify-center">
              Criar organização
            </button>
          </form>
        </div>

        <p className="text-[12px] mt-4 text-center" style={{ color: 'var(--muted)' }}>
          Já tem acesso?{' '}
          <Link href="/login" className="font-semibold" style={{ color: 'var(--brand-700)' }}>
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
