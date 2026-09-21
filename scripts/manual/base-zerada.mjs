/**
 * A base zerada continua utilizável pelos três usuários de teste.
 *
 * O SQL pode rodar sem erro e ainda assim entregar um sistema quebrado: um
 * colaborador sem registro de pessoa, um gestor sem equipe, uma tela que
 * estoura ao não achar escala nenhuma. Zerar a base é o começo do teste, não
 * o fim — se as telas não abrem, não há o que testar.
 *
 * Este roteiro entra como cada um dos três e confere que as telas do papel
 * dele carregam, sem faixa de erro e sem exceção de JavaScript.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';

const banco = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});
const sql = async (t, a = []) => (await banco.query(t, a)).rows;

let falhas = 0;
const conferir = (ok, rotulo) => {
  console.log(`  ${ok ? 'ok' : 'FALHOU'}: ${rotulo}`);
  if (!ok) falhas++;
};

const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

/** Abre a tela e cobra: sem 500, sem faixa vermelha, sem exceção. */
async function abrir(rota) {
  const resposta = await p.goto(`${BASE}${rota}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  const status = resposta?.status() ?? 0;
  const faixa = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')]
      .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
    return el ? el.textContent.trim() : null;
  });
  const texto = await p.evaluate(() => document.body.innerText);
  const estourou = /Application error|Unhandled Runtime Error|Internal Server Error/i.test(texto);
  conferir(
    status < 400 && !faixa && !estourou,
    `${rota} abre (${status}${faixa ? ` · faixa: ${faixa}` : ''}${estourou ? ' · a tela estourou' : ''})`,
  );
}

const papeis = [
  {
    email: 'teste_planejamento@teste.com',
    rotas: ['/', '/gerar', '/calendario', '/solicitacoes', '/colaboradores', '/usuarios', '/parametros', '/mural'],
  },
  {
    email: 'teste_gestor@teste.com',
    rotas: ['/', '/calendario', '/ocupacao', '/solicitacoes', '/mural'],
  },
  {
    email: 'teste_colaborador@teste.com',
    rotas: ['/hoje', '/minha-escala', '/solicitacoes', '/mural'],
  },
];

for (const { email, rotas } of papeis) {
  const [perfil] = await sql('select id, papel from perfis where lower(email) = $1', [email]);
  if (!perfil) {
    conferir(false, `${email} não existe na base`);
    continue;
  }
  console.log(`\n${email} (${perfil.papel})`);
  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: perfil.id, email }));
  for (const rota of rotas) await abrir(rota);
}

// E o colaborador precisa achar a si mesmo: é o vínculo que o script de
// semeadura existe para recriar, e o que falta quando alguém só zera a base.
console.log('\nO vínculo entre login e pessoa da operação');
{
  const vinculados = await sql(
    `select p.email from perfis p join colaboradores c on c.perfil_id = p.id
      where lower(p.email) in ('teste_gestor@teste.com', 'teste_colaborador@teste.com')`,
  );
  conferir(
    vinculados.length === 2,
    `gestor e colaborador têm registro de pessoa (${vinculados.length} de 2)`,
  );
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.slice(0, 3).join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> BASE DE TESTE UTILIZÁVEL' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
