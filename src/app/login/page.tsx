import { entrar } from '@/app/actions-sessao';
import { Simbolo } from '@/components/Marca';

/**
 * Sem porta de auto-cadastro.
 *
 * Todo acesso ao Jornada é concedido por alguém acima na corrente: o
 * Administrador Geral cria a área e o Administrador dela; o Administrador da
 * Área cadastra o Planejamento; o Planejamento cadastra gestores e
 * colaboradores. Ninguém entra por conta própria, então esta tela pede
 * credencial e mais nada — um link de "criar organização" prometeria um caminho
 * que o sistema não tem.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-3 mb-6">
          <Simbolo tamanho={44} />
          <div className="leading-tight">
            <h1 className="text-[19px] font-bold" style={{ letterSpacing: '-.025em' }}>Jornada</h1>
            <p
              className="mt-1"
              style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--faint)' }}
            >
              Gestão de equipes
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
          Sem acesso? Fale com quem administra a sua área.
        </p>
      </div>
    </div>
  );
}
