/**
 * Acesso em lote para quem já está na escala.
 *
 * O defeito que isto guarda é de omissão, e por isso nenhuma tela o acusava:
 * importar a planilha de colaboradores cria a FICHA de cada pessoa, e não o
 * LOGIN dela. A operação inteira entrava no sistema, aparecia na grade, e
 * ninguém conseguia entrar — o convite avulso é um por vez, e cada um devolve
 * uma senha que aparece uma única vez e some na navegação seguinte.
 *
 * O roteiro cobra as três coisas que separam "criou oitenta logins" de "criou
 * oitenta logins certos":
 *
 *  - quem NÃO pode entrar no lote fica de fora dizendo o porquê — sem e-mail,
 *    e-mail que já é login, e-mail repetido dentro do próprio lote, e quem está
 *    afastado ou desligado (que é justamente quem não se quer dar acesso sem
 *    olhar);
 *  - quem entra sai com senha PRÓPRIA. Uma senha só para todo mundo é a saída
 *    que qualquer um inventa quando a ferramenta não existe, e é uma senha
 *    compartilhada com a operação inteira;
 *  - a ficha e o login ficam LIGADOS. Sem o vínculo, o acesso é criado e a
 *    pessoa entra num sistema onde "Minha escala" está vazia.
 *
 * E cobra a segunda passada: rodar de novo não pode oferecer quem já foi
 * criado. É o erro que produz o segundo login da mesma pessoa.
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

/* ── A massa: um de cada motivo de recusa ────────────────────────────── */
//
// Montada por SQL de propósito. O que se testa aqui é a TRIAGEM do lote, e
// montá-la pela tela gastaria cinco cadastros para chegar ao mesmo estado.
await sql("update colaboradores set email = '' where matricula = '1002'");            // Bruno: sem e-mail
await sql("update colaboradores set email = 'carla.nunes@saolucas.com' where matricula = '1003'"); // Daniela: e-mail que já é login
await sql("update colaboradores set email = 'fernanda.castro@saolucas.com' where matricula = '1004'"); // Eduardo: igual ao da Fernanda
await sql("update colaboradores set status = 'afastado', motivo_status = 'AFAST_INSS' where matricula = '1006'"); // Gustavo

const semLoginAntes = await sql(
  "select nome, matricula from colaboradores where perfil_id is null and status = 'ativo' order by nome");

const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));
writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));

// Tudo é lido DENTRO do bloco do lote. A mesma tela lista os usuários da área
// logo acima, e depois de criar os acessos os nomes do lote passam a aparecer
// lá também — um `tr` solto casaria com a linha errada e diria que quem já foi
// criado continua na fila.
const bloco = p.locator('#acesso-em-lote');

const linhaDe = async nome => {
  const tr = bloco.locator('tr', { hasText: nome }).first();
  return (await tr.count()) ? (await tr.innerText()).replace(/\s+/g, ' ').trim() : null;
};

/* ── 1. A conferência ────────────────────────────────────────────────── */
console.log('1. Quem está sem acesso, e o que impede cada um');
await p.goto(`${BASE}/usuarios`, { waitUntil: 'networkidle' });
await bloco.locator('button:text-is("Procurar quem está sem acesso")').click();
await bloco.locator('text=/pronto\\(s\\), .* fora/').first().waitFor({ timeout: 20000 });

const resumo = await bloco.locator('text=/pronto\\(s\\), .* fora/').first().innerText();
conferir(/9 pronto\(s\), 3 fora/.test(resumo), `nove prontos e três fora ("${resumo.trim()}")`);

conferir(/Sem e-mail/i.test(await linhaDe('Bruno Alencar') ?? ''), 'Bruno fica fora por não ter e-mail');
conferir(/Já existe um usuário/i.test(await linhaDe('Daniela Prado') ?? ''),
  'Daniela fica fora porque o e-mail dela já é login da Carla');
// Entre Eduardo e Fernanda, que dividem o mesmo e-mail, passa o primeiro pela
// ordem de nome — e o segundo fica fora dizendo exatamente isso.
conferir(/já aparece em outra linha/i.test(await linhaDe('Fernanda Castro') ?? ''),
  'Fernanda fica fora porque o e-mail se repete no lote');
conferir(await linhaDe('Gustavo Reis') === null, 'Gustavo, afastado, nem aparece na lista');
conferir(semLoginAntes.length === 12, `doze ativos sem login antes (${semLoginAntes.length})`);

// Nada foi criado ainda: esta tela só conta o que aconteceria.
const [{ n: authAntes }] = await sql('select count(*)::int as n from auth.users');

/* ── 2. Tirar uma pessoa do lote na mão ──────────────────────────────── */
//
// A seleção precisa valer. Se o botão ignorasse as caixas e criasse a lista
// inteira, tudo abaixo continuaria passando — menos isto.
console.log('\n2. Desmarcar alguém');
await bloco.locator('input[aria-label="Criar acesso de Otávio Bandeira"]').uncheck();
const rotulo = await bloco.locator('button:has-text("acesso(s)")').first().innerText();
conferir(/8 acesso/.test(rotulo), `o botão passa a oferecer oito (${rotulo.trim()})`);

/* ── 3. Criar ────────────────────────────────────────────────────────── */
console.log('\n3. Os acessos');
await bloco.locator('button:has-text("Criar 8 acesso")').click();
await bloco.locator('text=/acesso\\(s\\) criado\\(s\\)/').first().waitFor({ timeout: 60000 });

const aviso = await bloco.locator('text=/acesso\\(s\\) criado\\(s\\)/').first().innerText();
conferir(/8 acesso/.test(aviso), `oito criados ("${aviso.trim()}")`);

const criados = await sql(`
  select c.nome, c.matricula, p.papel, p.conta_id = c.conta_id as mesma_area
    from colaboradores c join perfis p on p.id = c.perfil_id
   where c.matricula in ('1004','1007','1008','1009','1010','1011','1012','1014')
   order by c.nome`);
conferir(criados.length === 8, `oito fichas ligadas a um login (${criados.length})`);
conferir(criados.every(c => c.papel === 'colaborador'), 'todos com papel colaborador');
conferir(criados.every(c => c.mesma_area), 'todos na área de quem convidou');

const [{ n: authDepois }] = await sql('select count(*)::int as n from auth.users');
conferir(authDepois - authAntes === 8, `oito logins novos no Auth (${authDepois - authAntes})`);

// Otávio foi desmarcado: o lote não pode tê-lo levado junto.
const [otavio] = await sql("select perfil_id from colaboradores where matricula = '1013'");
conferir(otavio.perfil_id === null, 'Otávio, desmarcado, continua sem login');

// Bruno é a prova de que o rollback não foi acionado por engano nem o vínculo
// foi dado a quem estava fora.
const [bruno] = await sql("select perfil_id from colaboradores where matricula = '1002'");
conferir(bruno.perfil_id === null, 'Bruno, recusado, continua sem login');

/* ── 4. As senhas ────────────────────────────────────────────────────── */
//
// Uma por pessoa. A senha única para o lote inteiro é a saída que se inventa
// quando a ferramenta não existe — e ela é uma senha compartilhada por oitenta
// pessoas que ninguém consegue trocar depois.
console.log('\n4. Uma senha por pessoa');
const mostradas = await bloco.locator('td span.font-mono.font-semibold').allInnerTexts();
const senhas = mostradas.map(s => s.trim()).filter(s => /^[A-Za-z2-9]{12}$/.test(s));
conferir(senhas.length === 8, `oito senhas de doze caracteres na tela (${senhas.length})`);
conferir(new Set(senhas).size === 8, 'todas diferentes entre si');
conferir(senhas.every(s => !/[O0Il1]/.test(s)), 'sem os caracteres que se confundem ao ditar');

// A senha não fica gravada em lugar nenhum — nem em claro, nem no log.
const vestigio = await sql(
  'select count(*)::int as n from logs where detalhe like any ($1)', [senhas.map(s => `%${s}%`)]);
conferir(vestigio[0].n === 0, 'nenhuma senha aparece no log de auditoria');

conferir(await bloco.locator('button:has-text("Baixar as 8 senha")').count() === 1,
  'a lista de senhas pode ser baixada');

/* ── 5. A segunda passada ────────────────────────────────────────────── */
//
// Aqui mora o segundo login da mesma pessoa: se a busca não enxergasse o
// vínculo recém-criado, um clique distraído criaria tudo de novo.
console.log('\n5. Procurar de novo');
await bloco.locator('button:text-is("Procurar de novo")').click();
await p.waitForTimeout(1500);
const resumo2 = await bloco.locator('text=/pronto\\(s\\), .* fora/').first().innerText();
// Sobra exatamente quem não foi criado: Otávio, que eu desmarquei, e os três
// recusados. Os oito criados saíram da fila.
conferir(/1 pronto\(s\), 3 fora/.test(resumo2), `só o desmarcado continua pronto ("${resumo2.trim()}")`);
conferir(await linhaDe('Juliana Moraes') === null, 'quem acabou de receber acesso saiu da lista');

/* ── 6. O gestor não convida ─────────────────────────────────────────── */
console.log('\n6. Quem não pode');
writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: '00000000-0000-0000-0000-000000000002', email: 'ricardo@x' }));
await p.goto(`${BASE}/usuarios`, { waitUntil: 'networkidle' });
conferir(!/Procurar quem está sem acesso/.test(await p.evaluate(() => document.body.innerText)),
  'o gestor não chega nem à tela de usuários');

conferir(erros.length === 0, `nenhum erro de JS (${erros.slice(0, 2).join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> CONVITE EM LOTE OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
