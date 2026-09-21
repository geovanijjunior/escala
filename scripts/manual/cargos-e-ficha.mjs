/**
 * Cargo virou cadastro da área, e a ficha da pessoa ganhou CPF, nascimento e
 * telefone.
 *
 * O que este roteiro precisa provar, e que só se vê operando a tela:
 *
 *  - o cargo criado em Parâmetros APARECE nas duas portas que pedem cargo (a
 *    ficha do colaborador e o cadastro de usuário). Se a lista não chegar lá,
 *    criar cargo é um botão que não serve para nada;
 *  - o CPF é conferido pelos dígitos verificadores, e não só pelo tamanho;
 *  - o mesmo CPF não entra duas vezes na área — a recusa vem do índice único, e
 *    a tela precisa transformá-la em frase;
 *  - remover um cargo em uso é recusado. Esta é a mais fácil de deixar passar:
 *    o cargo é TEXTO na ficha, então o banco não reclamaria de nada. As pessoas
 *    continuariam no cargo e o campo apareceria vazio na edição seguinte.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ANA = '00000000-0000-0000-0000-000000000001';

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
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));
writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));

const faixaDeErro = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')]
    .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
  return el ? el.textContent.trim() : null;
});

const opcoesDeCargo = () =>
  p.locator('select[name="cargo"] option').evaluateAll(os => os.map(o => o.value).filter(Boolean));

/* ── 1. O Planejamento cria um cargo ─────────────────────────────────── */
console.log('1. Criar cargo em Parâmetros');
const NOVO = 'Enfermeiro de Teste';
{
  await sql('delete from cargos where nome = $1', [NOVO]);

  await p.goto(`${BASE}/parametros?aba=cargos&cargo=novo`, { waitUntil: 'networkidle' });
  const form = p.locator('form:has(button:text-is("Adicionar cargo"))');
  await form.waitFor({ timeout: 15000 });
  await form.locator('input[name="nome"]').fill(NOVO);
  await form.locator('input[name="ordem"]').fill('42');
  await form.locator('button:text-is("Adicionar cargo")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);

  const [criado] = await sql('select id, ordem from cargos where nome = $1', [NOVO]);
  conferir(!!criado, 'o cargo foi gravado');
  conferir(Number(criado?.ordem) === 42, `com a ordem informada (${criado?.ordem})`);
  conferir(!await faixaDeErro(), 'e a tela não reclamou');
}

/* ── 2. Nome repetido é recusado com frase, não com "duplicate key" ──── */
console.log('\n2. Cargo repetido');
{
  await p.goto(`${BASE}/parametros?aba=cargos&cargo=novo`, { waitUntil: 'networkidle' });
  const form = p.locator('form:has(button:text-is("Adicionar cargo"))');
  await form.locator('input[name="nome"]').fill(NOVO);
  await form.locator('button:text-is("Adicionar cargo")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);

  const erro = await faixaDeErro();
  conferir(!!erro && /já existe/i.test(erro), `recusou em português ("${(erro ?? '—').slice(0, 60)}")`);
  const quantos = await sql('select id from cargos where nome = $1', [NOVO]);
  conferir(quantos.length === 1, 'e não duplicou');
}

/* ── 3. O cargo novo chega às duas portas que pedem cargo ────────────── */
console.log('\n3. O cargo aparece onde se escolhe cargo');
{
  await p.goto(`${BASE}/colaboradores?novo=1`, { waitUntil: 'networkidle' });
  await p.locator('select[name="cargo"]').first().waitFor({ timeout: 15000 });
  const naFicha = await opcoesDeCargo();
  conferir(naFicha.includes(NOVO), `na ficha do colaborador (${naFicha.length} cargos)`);

  await p.goto(`${BASE}/usuarios`, { waitUntil: 'networkidle' });
  await p.locator('select[name="cargo"]').first().waitFor({ timeout: 15000 });
  const noUsuario = await opcoesDeCargo();
  conferir(noUsuario.includes(NOVO), 'no cadastro de usuário');
}

/* ── 4. CPF conferido pelos dígitos, e telefone e nascimento gravados ── */
console.log('\n4. CPF, nascimento e telefone na ficha');
{
  await sql("delete from colaboradores where matricula = 'FICHA-1'");
  const [equipe] = await sql('select id from equipes limit 1');
  const [unidade] = await sql('select id from unidades where ativa limit 1');

  const preencher = async (cpf) => {
    await p.goto(`${BASE}/colaboradores?novo=1`, { waitUntil: 'networkidle' });
    const f = p.locator('form:has(select[name="cargo"])').first();
    await f.locator('input[name="nome"]').fill('Pessoa da Ficha');
    await f.locator('input[name="matricula"]').fill('FICHA-1');
    await f.locator('input[name="cpf"]').fill(cpf);
    await f.locator('input[name="nascimento"]').fill('1990-05-17');
    await f.locator('input[name="telefone"]').fill('(11) 98765-4321');
    await f.locator('select[name="cargo"]').selectOption(NOVO);
    await f.locator('select[name="equipeId"]').selectOption(String(equipe.id));
    await f.locator('select[name="unidadeBaseId"]').selectOption(String(unidade.id));
    await f.locator('button[type="submit"]').first().click();
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(500);
  };

  // Onze dígitos que NÃO fecham a conta dos verificadores. Passariam por
  // qualquer validação que só contasse caracteres.
  await preencher('529.982.247-26');
  const erro = await faixaDeErro();
  conferir(!!erro && /CPF/i.test(erro), `CPF com dígito trocado é recusado ("${(erro ?? '—').slice(0, 55)}")`);
  const nenhuma = await sql("select id from colaboradores where matricula = 'FICHA-1'");
  conferir(nenhuma.length === 0, 'e nada foi gravado');

  await preencher('529.982.247-25');
  conferir(!await faixaDeErro(), 'o CPF correto passa');
  const [ficha] = await sql("select cpf, nascimento, telefone, cargo from colaboradores where matricula = 'FICHA-1'");
  conferir(ficha?.cpf === '52998224725', `o CPF é gravado só com dígitos (${ficha?.cpf})`);
  conferir(ficha?.telefone === '11987654321', `o telefone também (${ficha?.telefone})`);
  const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));
  conferir(iso(ficha?.nascimento) === '1990-05-17', `e o nascimento na data certa (${iso(ficha?.nascimento)})`);
  conferir(ficha?.cargo === NOVO, 'com o cargo novo escolhido');
}

/* ── 5. O mesmo CPF não entra duas vezes ─────────────────────────────── */
console.log('\n5. CPF repetido na área');
{
  await sql("delete from colaboradores where matricula = 'FICHA-2'");
  const [equipe] = await sql('select id from equipes limit 1');
  const [unidade] = await sql('select id from unidades where ativa limit 1');

  await p.goto(`${BASE}/colaboradores?novo=1`, { waitUntil: 'networkidle' });
  const f = p.locator('form:has(select[name="cargo"])').first();
  await f.locator('input[name="nome"]').fill('Outra Pessoa');
  await f.locator('input[name="matricula"]').fill('FICHA-2');
  await f.locator('input[name="cpf"]').fill('52998224725');
  await f.locator('select[name="equipeId"]').selectOption(String(equipe.id));
  await f.locator('select[name="unidadeBaseId"]').selectOption(String(unidade.id));
  await f.locator('button[type="submit"]').first().click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(500);

  conferir(!!await faixaDeErro(), 'a segunda ficha com o mesmo CPF é recusada');
  const quantas = await sql("select id from colaboradores where matricula = 'FICHA-2'");
  conferir(quantas.length === 0, 'e não foi gravada');
}

/* ── 6. Cargo em uso não pode ser apagado ────────────────────────────── */
//
// O banco não protegeria isto: o cargo é texto na ficha. Apagar deixaria as
// pessoas no cargo e o campo em branco na próxima edição.
console.log('\n6. Remover cargo em uso');
{
  await p.goto(`${BASE}/parametros?aba=cargos`, { waitUntil: 'networkidle' });
  const linha = p.locator('tr', { hasText: NOVO }).first();
  await linha.waitFor({ timeout: 15000 });
  await linha.locator('button:text-is("Remover")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);

  const erro = await faixaDeErro();
  conferir(!!erro && /colaborador/i.test(erro), `recusou nomeando quem está no cargo ("${(erro ?? '—').slice(0, 60)}")`);
  const vivo = await sql('select id from cargos where nome = $1', [NOVO]);
  conferir(vivo.length === 1, 'e o cargo continua lá');

  // Liberado o cargo, a remoção passa.
  await sql("delete from colaboradores where matricula in ('FICHA-1', 'FICHA-2')");
  await p.goto(`${BASE}/parametros?aba=cargos`, { waitUntil: 'networkidle' });
  await p.locator('tr', { hasText: NOVO }).first().locator('button:text-is("Remover")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);
  const depois = await sql('select id from cargos where nome = $1', [NOVO]);
  conferir(depois.length === 0, 'sem ninguém no cargo, ele é removido');
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.slice(0, 2).join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> CARGOS E FICHA OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
