/**
 * O caminho de ida e volta de um pedido que mexe na escala.
 *
 * Planejamento abre PELA pessoa → gestor aprova → volta ao Planejamento com "A
 * implantar" → ele confirma, e só então a ausência entra na escala.
 *
 * O que precisa ser provado aqui não é que a máquina de estados tem os estados:
 * é que a escrita acontece no passo CERTO. A RLS só deixa o Planejamento
 * escrever em `pins` e `ausencias`, e enquanto a aprovação do gestor ia direto
 * para APROVADA esses dois inserts falhavam calados — o pedido dizia "Aplicada
 * na escala" e a escala não tinha mudado. Por isso o roteiro confere o banco
 * depois de CADA passo, inclusive para confirmar que nada foi escrito cedo
 * demais.
 *
 * Cada passo é feito clicando no que a tela oferece. Encontrar um seletor não
 * prova que o botão faz o que diz.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const PLANEJAMENTO = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';

const banco = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});

const sou = id => writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: `${id}@x` }));
const sql = async (texto, args = []) => (await banco.query(texto, args)).rows;
const dormir = ms => new Promise(r => setTimeout(r, ms));

/**
 * Espera a condição virar verdadeira, até dois segundos.
 *
 * Server Action redireciona por navegação do lado do cliente, e `networkidle`
 * volta antes de o servidor ter terminado de gravar. Sem esta espera o roteiro
 * lê o banco cedo, não acha a linha e acusa uma falha que não existe — foi
 * exatamente o que aconteceu na primeira execução.
 */
async function ate(fn) {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await dormir(50);
  }
  return null;
}

let falhas = 0;
function conferir(condicao, rotulo) {
  console.log(`  ${condicao ? 'ok' : 'FALHOU'}: ${rotulo}`);
  if (!condicao) falhas++;
}

const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push('JS: ' + e.message));

// O alvo: alguém da equipe do gestor Ricardo, para que o pedido caia mesmo na
// caixa dele. `gestor_id` guarda o perfil (uuid) do gestor, não o id do
// colaborador dele.
const [alvo] = await sql(`
  select c.id, c.nome from colaboradores c
   where c.gestor_id = $1::uuid and c.status = 'ativo' and c.equipe_id is not null
   order by c.id limit 1`, [GESTOR]);
if (!alvo) { console.log('sem colaborador na equipe do gestor — massa incompleta'); process.exit(1); }

const DATA = '2026-11-16';
const FIM = '2026-11-18';
const CARTAO = 'Folgas · 16/11/2026 a 18/11/2026';
console.log(`alvo: ${alvo.nome} (#${alvo.id}) · ${CARTAO}\n`);

await sql('delete from pins where colaborador_id = $1 and data between $2 and $3', [alvo.id, DATA, FIM]);
await sql('delete from ausencias where colaborador_id = $1 and inicio = $2', [alvo.id, DATA]);
await sql(`delete from solicitacao_eventos where solicitacao_id in
             (select id from solicitacoes where colaborador_id = $1 and data = $2)`, [alvo.id, DATA]);
await sql('delete from solicitacoes where colaborador_id = $1 and data = $2', [alvo.id, DATA]);

/* ── 1. Planejamento abre o pedido em nome da pessoa ───────────────────── */
console.log('1. Planejamento abre pela pessoa');
sou(PLANEJAMENTO);
await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });

const abrir = p.getByRole('link', { name: /Abrir solicitação para um colaborador/i });
conferir(await abrir.count() > 0, 'o botão de abrir por outro está no cabeçalho');
await abrir.first().click();

// "Para quem" é campo digitável, não `<select>`: com duzentos colaboradores a
// lista rolável era o passo mais lento do formulário. O que o servidor recebe
// continua sendo o id, num `hidden` que só é preenchido quando o texto casa com
// alguém da lista — então o roteiro digita o RÓTULO inteiro, como quem escolhe
// uma sugestão do navegador, e confere que o id chegou.
const paraQuem = p.locator('input[list]').first();
await paraQuem.waitFor({ timeout: 10000 });
conferir(await paraQuem.count() > 0, 'o formulário pergunta "para quem"');

const listaId = await paraQuem.getAttribute('list');
const rotulos = await p.evaluate(id => [...document.getElementById(id).options].map(o => o.value), listaId);
const rotulo = rotulos.find(r => r.startsWith(alvo.nome));
conferir(!!rotulo, `o nome do alvo está na lista ("${rotulo ?? '—'}")`);
await paraQuem.fill(rotulo);
await p.waitForTimeout(250);
conferir(
  await p.locator('input[type=hidden][name="colaboradorId"]').inputValue() === String(alvo.id),
  'digitar o nome resolveu o id da pessoa',
);
await p.selectOption('select[name="tipo"]', 'FOLGA');
await p.fill('input[name="data"]', DATA);
await p.fill('input[name="dataFim"]', FIM);
await p.fill('textarea[name="detalhe"]', 'Folga combinada na reunião de escala de novembro.');
await p.screenshot({ path: '/tmp/impl-1-form.png', fullPage: true });
await p.getByRole('button', { name: /Abrir solicitação/i }).click();

const [criada] = (await ate(async () => sql(
  `select id, status, aberta_pelo_planejamento, aplicada from solicitacoes
    where colaborador_id = $1 and data = $2`, [alvo.id, DATA]))) ?? [];
conferir(!!criada, 'a solicitação foi gravada');
conferir(criada?.status === 'TRIAGEM', `caiu na triagem, como qualquer outra (status=${criada?.status})`);
conferir(criada?.aberta_pelo_planejamento === true, 'ficou marcada como aberta pelo Planejamento');

// As cinco saídas têm de estar ali: é justamente o que o pedido perdia quando
// pulava a triagem e ia direto para a caixa do gestor.
const cartao = () => p.locator('section.esc-card').filter({ hasText: CARTAO });
await cartao().first().waitFor({ timeout: 10000 });
for (const botao of ['Aprovar', 'Encaminhar ao gestor', 'Tratativa futura', 'Recusar']) {
  conferir(
    await cartao().getByRole('button', { name: new RegExp(`^${botao}$`) }).count() === 1,
    `a triagem oferece "${botao}"`,
  );
}
await p.screenshot({ path: '/tmp/impl-2-aberta.png', fullPage: true });

/* ── 1b. Dali o Planejamento encaminha ao gestor ───────────────────────── */
await cartao().getByRole('button', { name: /^Encaminhar ao gestor$/ }).click();
conferir(
  !!(await ate(async () => sql("select 1 from solicitacoes where id = $1 and status = 'GESTOR'", [criada.id]))),
  'encaminhou ao gestor',
);

/* ── 2. Gestor aprova: decide, mas não mexe na escala ──────────────────── */
console.log('\n2. Gestor aprova');
sou(GESTOR);
await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
conferir(await cartao().count() === 1, 'o pedido chegou na caixa do gestor');
conferir(
  (await cartao().innerText()).includes('volta ao Planejamento, que lança os dias e confirma'),
  'o gestor é avisado de que aprovar não altera a escala agora',
);
await p.screenshot({ path: '/tmp/impl-3-gestor.png', fullPage: true });
await cartao().getByRole('button', { name: /^Aprovar$/ }).click();

const [aprovada] = (await ate(async () =>
  sql(`select status, aplicada from solicitacoes where id = $1 and status <> 'GESTOR'`, [criada.id]))) ?? [];
conferir(aprovada?.status === 'IMPLANTAR', `parou em IMPLANTAR (status=${aprovada?.status})`);
conferir(aprovada?.aplicada !== true, 'não se declarou aplicada na escala');
const travasCedo = await sql('select 1 from pins where colaborador_id = $1 and data = $2', [alvo.id, DATA]);
conferir(travasCedo.length === 0, 'a escala NÃO foi alterada pela aprovação do gestor');
const ausCedo = await sql('select 1 from ausencias where colaborador_id = $1 and inicio = $2', [alvo.id, DATA]);
conferir(ausCedo.length === 0, 'a ausência ainda não existe');

/* ── 3. Planejamento implanta e confirma ───────────────────────────────── */
console.log('\n3. Planejamento confirma a implantação');
sou(PLANEJAMENTO);
await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
conferir(await cartao().count() === 1, 'o pedido voltou para a aba Abertas, não para o Histórico');
conferir((await cartao().innerText()).includes('A implantar'), 'marcado como "A implantar"');
await p.screenshot({ path: '/tmp/impl-4-implantar.png', fullPage: true });

const confirmar = cartao().getByRole('button', { name: /Confirmar implantação/i });
conferir(await confirmar.count() === 1, 'o botão de confirmar existe');
await confirmar.click();

const [fim] = (await ate(async () =>
  sql(`select status, aplicada from solicitacoes where id = $1 and status = 'APROVADA'`, [criada.id]))) ?? [];
conferir(fim?.status === 'APROVADA', `encerrou como APROVADA (status=${fim?.status})`);
conferir(fim?.aplicada === true, 'ficou marcada como aplicada na escala');
const travas = await sql(
  'select data from pins where colaborador_id = $1 and data between $2 and $3', [alvo.id, DATA, FIM]);
conferir(travas.length === 3, `os três dias foram travados na escala (${travas.length})`);
const [aus] = await sql(
  'select dias, grupo, motivo from ausencias where colaborador_id = $1 and inicio = $2', [alvo.id, DATA]);
conferir(Number(aus?.dias) === 3, `a ausência cobre o período inteiro (${aus?.dias} dia(s))`);
await p.screenshot({ path: '/tmp/impl-5-confirmada.png', fullPage: true });

/* ── 4. O caminho do colaborador não perdeu a triagem ──────────────────── */
console.log('\n4. O pedido do colaborador continua passando pela triagem');
const [normal] = await sql(
  `select id from solicitacoes where aberta_pelo_planejamento = false and status = 'TRIAGEM' limit 1`);
conferir(!!normal, 'ainda há pedido em triagem — o caminho antigo segue de pé');

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> IMPLANTAÇÃO OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
