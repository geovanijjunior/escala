/**
 * Abre uma sessão à mão, para desenvolver sem o SSO configurado.
 *
 *   npx tsx --env-file=.env scripts/sessao-de-teste.ts ana.ribeiro@saolucas.com
 *
 * É um SCRIPT, e não uma rota de desenvolvimento dentro da API, de propósito.
 * Uma rota que abre sessão sem autenticar — mesmo protegida por um `if` de
 * ambiente — é uma porta que existe no código que vai para produção, e basta
 * uma variável mal configurada para ela abrir lá. Aqui não há porta: quem roda
 * isto já tem acesso ao banco, e quem tem acesso ao banco já podia tudo.
 */
import { randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email) {
  console.error('Uso: tsx --env-file=.env scripts/sessao-de-teste.ts <email>');
  process.exit(1);
}

const prisma = new PrismaClient();

const perfil = await prisma.perfis.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
});

if (!perfil) {
  console.error(`Nenhum perfil com o e-mail ${email}.`);
  const alguns = await prisma.perfis.findMany({ select: { email: true, papel: true }, take: 10 });
  console.error('Disponíveis:', alguns.map(p => `${p.email} (${p.papel})`).join(', '));
  await prisma.$disconnect();
  process.exit(1);
}

const valor = randomBytes(32).toString('base64url');
await prisma.sessoes.create({
  data: {
    id: createHash('sha256').update(valor).digest('hex'),
    perfil_id: perfil.id,
    expira_em: new Date(Date.now() + 8 * 3600_000),
    ip: '127.0.0.1',
    agente: 'script de desenvolvimento',
  },
});

console.log(`Sessão aberta para ${perfil.nome} (${perfil.papel}).\n`);
console.log('No navegador, no console da página do frontend:');
console.log(`  document.cookie = 'jornada_sessao=${valor}; path=/'\n`);
console.log('Ou no curl:');
console.log(`  curl --cookie 'jornada_sessao=${valor}' http://localhost:3333/colaboradores`);

await prisma.$disconnect();
