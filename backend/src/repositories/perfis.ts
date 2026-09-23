import { prisma } from '../config/prisma.ts';

/**
 * Os perfis — quem existe no sistema e com qual papel.
 *
 * O acesso a dados vive aqui e não nas rotas, como manda o padrão. O ganho não
 * é organizacional: é que o dia em que o vínculo com o SSO mudar, muda um
 * arquivo, e não sete lugares que faziam a mesma consulta com variações.
 */

export interface Perfil {
  id: string;
  nome: string;
  email: string;
  papel: string;
  contaId: string | null;
  bloqueado: boolean;
  ssoSub: string | null;
}

const paraPerfil = (p: {
  id: string; nome: string; email: string; papel: string;
  conta_id: string | null; bloqueado: boolean; sso_sub: string | null;
}): Perfil => ({
  id: p.id,
  nome: p.nome,
  email: p.email,
  papel: p.papel,
  contaId: p.conta_id,
  bloqueado: p.bloqueado,
  ssoSub: p.sso_sub,
});

/** Pelo identificador do provedor — o caminho de todo login depois do primeiro. */
export async function porSsoSub(sub: string): Promise<Perfil | null> {
  const p = await prisma.perfis.findFirst({ where: { sso_sub: sub } });
  return p ? paraPerfil(p) : null;
}

/**
 * Pelo e-mail — só para o PRIMEIRO encontro.
 *
 * Depois que o vínculo existe, a busca é sempre pelo `sub`: e-mail muda, e
 * quando muda a pessoa viraria outra se ele fosse a identidade.
 */
export async function porEmail(email: string): Promise<Perfil | null> {
  const p = await prisma.perfis.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
  });
  return p ? paraPerfil(p) : null;
}

/**
 * Liga um perfil existente à identidade do provedor.
 *
 * `sso_sub: null` na condição é o que impede roubar o vínculo de alguém: se
 * duas pessoas do SSO tiverem o mesmo e-mail cadastrado aqui — o que acontece
 * quando alguém sai e o endereço é reaproveitado —, a segunda não toma o lugar
 * da primeira em silêncio. A gravação devolve zero linhas e o login é recusado.
 */
export async function ligarAoSso(perfilId: string, sub: string): Promise<boolean> {
  const r = await prisma.perfis.updateMany({
    where: { id: perfilId, sso_sub: null },
    data: { sso_sub: sub },
  });
  return r.count === 1;
}

/** O nome que o provedor informa passa a valer, quando mudou. */
export async function atualizarNome(perfilId: string, nome: string): Promise<void> {
  if (!nome.trim()) return;
  await prisma.perfis.updateMany({
    where: { id: perfilId, NOT: { nome } },
    data: { nome: nome.trim() },
  });
}
