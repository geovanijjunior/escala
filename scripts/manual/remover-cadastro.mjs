/**
 * Remover cadastro errado — e recusar remover o que já tem história.
 *
 * O pedido foi "quero apagar uma equipe que criei errada". A parte fácil é o
 * botão. A parte que decide se a regra presta é a recusa: o que NÃO pode sumir,
 * e se a tela explica o motivo em vez de devolver erro de chave estrangeira.
 *
 * Três recusas importam mais que as outras, porque em duas delas o banco
 * deixaria passar:
 *
 *  - `comunicados.equipe_id` é `on delete set null`, e comunicado sem equipe é
 *    comunicado para a área inteira. Apagar a equipe destinatária ABRIRIA para
 *    todo mundo um recado dirigido a cinco pessoas, calado;
 *  - `solicitacoes.unidade_desejada_id` também é `set null`: apagar a unidade
 *    transformaria "quero ir para o Morumbi" num pedido sem destino;
 *  - só a terceira — colaborador na equipe / com a unidade como base — o banco
 *    barraria sozinho, e ainda assim falando de constraint, que não diz a
 *    ninguém o que fazer a seguir.
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
const conta = async (t, a = []) => Number((await sql(t, a))[0].c);

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

/** A faixa vermelha da tela, que é onde a recusa precisa aparecer. */
const faixaDeErro = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')]
    .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
  return el ? el.textContent.trim() : null;
});

/** Clica o Remover da linha cujo texto contém `nome`, e espera a resposta. */
async function removerLinha(url, nome) {
  await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  const linha = p.locator('tr', { hasText: nome }).first();
  await linha.waitFor({ timeout: 15000 });
  await linha.locator('button:text-is("Remover")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);
  return faixaDeErro();
}

/* ── 1. Equipe criada errada: some ───────────────────────────────────── */
console.log('1. Equipe criada errada é removida');
{
  await sql("delete from equipes where nome = 'Analistas Suport'");
  const [{ conta_id }] = await sql('select conta_id from equipes limit 1');
  await sql("insert into equipes (conta_id, nome, turno) values ($1, 'Analistas Suport', 'D')", [conta_id]);

  const antes = await conta("select count(*) c from equipes where nome = 'Analistas Suport'");
  conferir(antes === 1, 'a equipe errada existe antes');

  const erro = await removerLinha('/parametros?aba=equipes', 'Analistas Suport');
  conferir(!erro, `a tela não reclamou (${erro ?? 'sem faixa'})`);
  const depois = await conta("select count(*) c from equipes where nome = 'Analistas Suport'");
  conferir(depois === 0, `e a equipe saiu do banco (${antes} → ${depois})`);
}

/* ── 2. Equipe com gente: recusada, e a tela diz o porquê ────────────── */
console.log('\n2. Equipe com colaboradores é recusada');
{
  const [alvo] = await sql(
    `select e.id, e.nome, count(c.id)::int as pessoas from equipes e
       join colaboradores c on c.equipe_id = e.id
      group by e.id, e.nome order by pessoas desc limit 1`);

  const erro = await removerLinha('/parametros?aba=equipes', alvo.nome);
  conferir(!!erro, `a tela recusou com mensagem ("${(erro ?? '—').slice(0, 70)}…")`);
  conferir(
    !!erro && /colaborador/i.test(erro) && /fora da escala|outra equipe/i.test(erro),
    'a mensagem nomeia o que segura e aponta a saída',
  );
  const viva = await conta('select count(*) c from equipes where id = $1', [alvo.id]);
  conferir(viva === 1, 'e a equipe continua lá');
}

/* ── 3. Equipe com comunicado: a recusa que o banco não faria ────────── */
console.log('\n3. Equipe destinatária de comunicado é recusada');
{
  await sql("delete from equipes where nome = 'Equipe do Recado'");
  const [{ conta_id }] = await sql('select conta_id from equipes limit 1');
  const [nova] = await sql(
    "insert into equipes (conta_id, nome, turno) values ($1, 'Equipe do Recado', 'D') returning id",
    [conta_id]);
  await sql(
    `insert into comunicados (conta_id, autor_id, autor_nome, titulo, corpo, equipe_id, publico)
     values ($1, $2, 'Ana', 'Recado da equipe', 'só para vocês', $3, 'colaboradores')`,
    [conta_id, ANA, nova.id]);

  const erro = await removerLinha('/parametros?aba=equipes', 'Equipe do Recado');
  conferir(!!erro && /comunicado/i.test(erro), `recusou citando o comunicado ("${(erro ?? '—').slice(0, 70)}…")`);

  // O que se estava protegendo: o recado continua dirigido à equipe, e não
  // aberto para a área inteira.
  const [recado] = await sql("select equipe_id from comunicados where titulo = 'Recado da equipe'");
  conferir(recado?.equipe_id === nova.id, 'e o comunicado segue dirigido só a ela');

  await sql("delete from comunicados where titulo = 'Recado da equipe'");
  await sql('delete from equipes where id = $1', [nova.id]);
}

/* ── 4. Unidade criada errada: some ──────────────────────────────────── */
console.log('\n4. Unidade criada errada é removida');
{
  await sql("delete from unidades where sigla = 'XYZ'");
  const [{ conta_id }] = await sql('select conta_id from unidades limit 1');
  await sql(
    "insert into unidades (conta_id, nome, sigla) values ($1, 'Unidade Errada', 'XYZ')", [conta_id]);

  const erro = await removerLinha('/parametros?aba=unidades', 'Unidade Errada');
  conferir(!erro, `a tela não reclamou (${erro ?? 'sem faixa'})`);
  const depois = await conta("select count(*) c from unidades where sigla = 'XYZ'");
  conferir(depois === 0, 'e a unidade saiu do banco');
}

/* ── 5. Unidade em operação: recusada, apontando para desativar ──────── */
console.log('\n5. Unidade que é base de alguém é recusada');
{
  const [alvo] = await sql(
    `select u.id, u.nome from unidades u join colaboradores c on c.unidade_base_id = u.id limit 1`);

  const erro = await removerLinha('/parametros?aba=unidades', alvo.nome);
  conferir(!!erro, `a tela recusou ("${(erro ?? '—').slice(0, 70)}…")`);
  conferir(!!erro && /desative/i.test(erro), 'e aponta desativar como o caminho certo');
  const viva = await conta('select count(*) c from unidades where id = $1', [alvo.id]);
  conferir(viva === 1, 'a unidade continua lá');
}

/* ── 6. Unidade destino de pedido: a outra recusa invisível ──────────── */
console.log('\n6. Unidade destino de pedido de troca é recusada');
{
  await sql("delete from unidades where sigla = 'DST'");
  const [{ conta_id }] = await sql('select conta_id from unidades limit 1');
  const [destino] = await sql(
    "insert into unidades (conta_id, nome, sigla) values ($1, 'Unidade Destino', 'DST') returning id", [conta_id]);
  const [quem] = await sql('select id from colaboradores limit 1');
  await sql(
    `insert into solicitacoes (conta_id, colaborador_id, tipo, status, data, detalhe, unidade_desejada_id)
     values ($1, $2, 'TROCA_UNIDADE', 'TRIAGEM', '2026-11-10', 'quero ir para lá', $3)`,
    [conta_id, quem.id, destino.id]);

  const erro = await removerLinha('/parametros?aba=unidades', 'Unidade Destino');
  conferir(!!erro && /pedido/i.test(erro), `recusou citando o pedido ("${(erro ?? '—').slice(0, 70)}…")`);

  const [pedido] = await sql("select unidade_desejada_id from solicitacoes where detalhe = 'quero ir para lá'");
  conferir(pedido?.unidade_desejada_id === destino.id, 'e o pedido continua com destino');

  await sql("delete from solicitacoes where detalhe = 'quero ir para lá'");
  await sql('delete from unidades where id = $1', [destino.id]);
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.slice(0, 2).join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> REMOÇÃO DE CADASTRO OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
