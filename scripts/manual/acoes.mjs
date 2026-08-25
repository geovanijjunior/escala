/**
 * Exercita cada ação de escrita com dados válidos e confere que ela gravou.
 *
 * O critério é duplo: nenhuma faixa de erro na tela E a linha correspondente no
 * banco. Só olhar a tela deixaria passar a ação que redireciona feliz sem ter
 * escrito nada.
 */
import { abrirNavegador } from './navegador.mjs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Semeia antes de começar. Sem isto o roteiro só passa na primeira execução: a
// segunda encontra os códigos que ela mesma cadastrou e acusa 13 falhas que são
// dela. Suíte que só roda uma vez não serve para regressão.
execFileSync('npx', ['tsx', 'scripts/manual/semear.ts'], {
  stdio: 'ignore',
  env: { ...process.env, PGDATABASE: process.env.PGDATABASE || 'manual' },
});

// Mesmos padrões do shim, e pelas mesmas variáveis: o cluster de teste pode
// estar no socket padrão da distribuição em vez de `/tmp:5433`, e um endereço
// cravado aqui faria a suíte morrer em ECONNREFUSED com cara de app quebrado.
const db = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});
const BASE = process.env.BASE || 'http://localhost:3000';
const COMP = 'competencia=2026-11-01';
const como = id => writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: 'x@x' }));
const ANA = '00000000-0000-0000-0000-000000000001';
const RICARDO = '00000000-0000-0000-0000-000000000002';
const FELIPE = '00000000-0000-0000-0000-000000000003';
const MARCOS = '00000000-0000-0000-0000-000000000005'; // administrador da área
const HELENA = '00000000-0000-0000-0000-000000000009'; // administradora geral

const b = await abrirNavegador({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8' } });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const p = await ctx.newPage();
let falhas = 0;

const conta = async sql => Number((await db.query(sql)).rows[0].c);

/** Predicados de `esperado`, para quando o número exato não é o que importa. */
const MENOS = (depois, antes) => depois < antes;
const MAIS = (depois, antes) => depois > antes;

/**
 * Roda uma ação e confere tela + banco.
 *
 * A conferência insiste por alguns segundos em vez de olhar uma vez depois de
 * uma espera fixa. A espera fixa dava dois danos: acusava falha em ação que só
 * demorou mais que o combinado, e — pior — devolvia o controle com a
 * requisição ainda em voo, de modo que o `como()` seguinte trocava o usuário
 * embaixo dela e a gravação saía com o nome errado. Passei um tempo atrás de
 * um bug de permissão que era só isto.
 *
 * `esperado` aceita três formas, e a terceira nasceu das remoções: número exato,
 * `undefined` para "tem de crescer", ou um predicado `(depois, antes) => bool`.
 * Sem o predicado, uma remoção só podia ser escrita como um número cravado — e
 * cravar `0` numa tabela que a massa já povoa é afirmar que a tela apagou tudo,
 * não a linha que se pediu. As três primeiras remoções cobertas aqui falharam
 * exatamente assim, apagando a linha certa.
 */
async function acao(nome, url, passos, sql, esperado) {
  const antes = sql ? await conta(sql) : null;
  await p.goto(BASE + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  try { await passos(p); } catch (e) {
    falhas++; console.log(`  ERRO  ${nome.padEnd(34)} não consegui operar: ${String(e).split('\n')[0].slice(0, 90)}`);
    return;
  }
  await p.waitForLoadState('networkidle');

  const bateu = d =>
    typeof esperado === 'function' ? esperado(d, antes)
    : esperado === undefined ? d > antes
    : d === esperado;
  let depois = null;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(150);
    if (sql === null) break;
    depois = await conta(sql);
    if (bateu(depois)) break;
  }

  const faixa = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
    return el ? el.textContent.trim() : null;
  });
  const gravou = sql === null || bateu(depois);

  if (faixa || !gravou) {
    falhas++;
    console.log(`  FALHOU ${nome.padEnd(33)} ${faixa ? 'erro na tela: ' + faixa : `banco não mudou (${antes} → ${depois})`}`);
  } else {
    console.log(`  ok     ${nome.padEnd(33)} ${sql ? `${antes} → ${depois}` : ''}`);
  }
}

como(ANA);

// ── Parâmetros ────────────────────────────────────────────────
//
// Todo formulário de cadastro nesta tela fica FECHADO até alguém pedir: o de
// unidade e o de equipe por `?unidade=novo` / `?equipe=novo`, os cinco demais
// por `?form=<nome>`. O roteiro precisa abrir o mesmo que uma pessoa abriria,
// e é por isso que a URL carrega o parâmetro — sem ele o campo não existe na
// página, e o que se lê é um timeout de `fill`, que parece o app travado.
await acao('salvarUnidade', '/parametros?aba=unidades&unidade=novo', async p => {
  // Sem `codigo`: desde a 0018 quem o gera é o banco, e o campo saiu da tela.
  await p.fill('form:has(button:text("Adicionar unidade")) input[name="nome"]', 'Vila Olímpia');
  await p.fill('input[name="sigla"]', 'VLO');
  await p.click('button:text("Adicionar unidade")');
}, "select count(*) c from unidades");

await acao('salvarCapacidade', '/parametros?aba=unidades&form=capacidade', async p => {
  const f = p.locator('form:has(button:text("Salvar"))').filter({ has: p.locator('input[name="reservadas"]') }).first();
  await f.locator('label:has-text("Qua") input[type=checkbox]').check();
  await f.locator('input[name="reservadas"]').fill('3');
  await f.locator('button:text("Salvar")').click();
}, "select count(*) c from capacidades");

await acao('salvarCotaEquipe', '/parametros?aba=unidades&form=cota', async p => {
  const f = p.locator('form:has(button:text("Salvar cota"))');
  await f.locator('select[name="unidadeId"]').selectOption({ index: 1 });
  // `minimo`, não `limite`: desde a 0021 a cota é um piso, não um teto.
  await f.locator('input[name="minimo"]').fill('4');
  await f.locator('button:text("Salvar cota")').click();
}, "select count(*) c from cotas_equipe");

await acao('salvarPosto', '/parametros?aba=unidades&form=posto', async p => {
  const f = p.locator('form:has(button:text("Adicionar posto"))');
  await f.locator('input[name="nome"]').fill('Pronto Atendimento');
  await f.locator('button:text("Adicionar posto")').click();
}, "select count(*) c from postos");

await acao('salvarParametros', '/parametros?aba=unidades&form=motor', async p => {
  await p.fill('input[name="tolerancia"]', '4');
  await p.click('button:text("Salvar parâmetros")');
}, "select tolerancia_aderencia c from config", 4);

await acao('salvarEquipe', '/parametros?aba=equipes&equipe=novo', async p => {
  // Mesmo motivo da unidade: o código da equipe é gerado desde a 0018.
  const f = p.locator('form:has(button:text("Adicionar equipe"))');
  await f.locator('input[name="nome"]').fill('Infraestrutura');
  await f.locator('button:text("Adicionar equipe")').click();
}, "select count(*) c from equipes");

await acao('salvarFeriado', '/parametros?aba=feriados&form=feriado', async p => {
  const f = p.locator('form:has(button:text("Adicionar feriado"))');
  // Uma data QUALQUER menos um feriado nacional: desde a 0022 os nacionais já
  // nascem com a área, e cadastrar o Natal não muda contagem nenhuma — o
  // roteiro acusava "banco não mudou" numa gravação que estava correta.
  await f.locator('input[name="data"]').fill('2026-08-11');
  await f.locator('input[name="nome"]').fill('Aniversário da unidade');
  await f.locator('button:text("Adicionar feriado")').click();
}, "select count(*) c from feriados");

// Trazer os nacionais de um ano que ainda não tem nenhum.
//
// A 0022 semeia o ano vigente ao criar a área; este botão é como se traz
// qualquer outro. Vale 2028 justamente por estar fora do que a semeadura fez —
// pedir o ano já semeado devolveria zero linha nova e o roteiro leria isso como
// falha de uma ação que funcionou.
await acao('trazerFeriadosNacionais', '/parametros?aba=feriados', async p => {
  const f = p.locator('form:has(button:text("Trazer"))');
  await f.locator('input[name="ano"]').fill('2028');
  await f.locator('button:text("Trazer")').click();
}, "select count(*) c from feriados where extract(year from data) = 2028");

// ── Parâmetros: o que se cadastra, se apaga ──────────────────
//
// As quatro remoções nunca tinham sido exercitadas. Cada uma vem logo depois de
// a linha correspondente ter sido criada acima, então a contagem cai de volta
// ao que era — e é essa volta que prova que o botão apaga a linha certa, e não
// simplesmente alguma.
await acao('removerCapacidade', '/parametros?aba=unidades', async p => {
  const bloco = p.locator('section:has-text("Capacidade e posições reservadas por dia")').first();
  await bloco.locator('button:text("Remover")').first().click();
}, "select count(*) c from capacidades", MENOS);

await acao('removerCotaEquipe', '/parametros?aba=unidades', async p => {
  const bloco = p.locator('section:has-text("Cota de posições por equipe")').first();
  await bloco.locator('button:text("Remover")').first().click();
}, "select count(*) c from cotas_equipe", MENOS);

await acao('removerPosto', '/parametros?aba=unidades', async p => {
  const bloco = p.locator('section:has-text("Postos dentro das unidades")').first();
  await bloco.locator('button:text("Remover")').first().click();
}, "select count(*) c from postos", MENOS);

await acao('removerFeriado', '/parametros?aba=feriados', async p => {
  const linha = p.locator('li:has-text("Aniversário da unidade"), tr:has-text("Aniversário da unidade")').first();
  await linha.locator('button:text("Remover")').click();
}, "select count(*) c from feriados where nome = 'Aniversário da unidade'", 0);

// ── Plano do mês ──────────────────────────────────────────────
await acao('salvarPlano', `/planos?${COMP}&colab=3`, async p => {
  // Muda a distribuição para 100% na primeira unidade — dá para conferir no banco.
  const linhas = p.locator('#editor-plano [data-unidade], #editor-plano label:has(button:text("100%"))');
  await p.locator('#editor-plano button:text-is("0%")').nth(1).click();
  await p.locator('#editor-plano button:text-is("100%")').first().click();
  void linhas;
  await p.click('#editor-plano button:text("Salvar plano")');
}, "select percentual c from plano_distribuicao d join planos pl on pl.id = d.plano_id"
 + " where pl.colaborador_id = 3 and pl.competencia = '2026-11-01' and d.unidade_id = 1", 100);

// Férias saíram do plano do mês.
//
// Havia duas portas para criá-las — o formulário aqui e a solicitação aprovada
// — e a daqui produzia férias sem nenhuma decisão por trás, apagáveis por um
// botão que não desfazia a solicitação correspondente. Agora entram por um
// caminho só, e o plano apenas mostra o que já foi decidido. A conferência é
// negativa de propósito: o que precisa continuar valendo é a AUSÊNCIA do
// formulário, e um roteiro que só testa o que existe nunca percebe uma porta
// reaberta por engano.
{
  await p.goto(`${BASE}/planos?${COMP}&colab=3`, { waitUntil: 'networkidle' });
  const formulario = await p.locator('form:has(button:text("Lançar férias"))').count();
  // "solicitação aprovada" em vez da frase inteira: o texto do bloco já foi
  // reescrito uma vez, e cravar a redação faz o teste quebrar quando alguém
  // melhora a explicação — que é o oposto do que ele deveria proteger.
  const aponta = /solicita[çc][ãa]o aprovada/i.test(await p.evaluate(() => document.body.innerText));
  if (formulario > 0 || !aponta) {
    falhas++;
    console.log(`  FALHOU férias fora do plano do mês        ${formulario > 0
      ? 'o formulário de lançar férias voltou'
      : 'a tela não diz de onde as férias vêm'}`);
  } else console.log('  ok     férias fora do plano do mês');
}

// O plano do mês virou leitura para ausência também.
//
// Era a segunda porta para criá-las, e produzia ausência sem nenhuma decisão
// por trás: ninguém pediu, ninguém aprovou, e o histórico do pedido — que é o
// que responde "quem autorizou isso?" — não existia. A conferência é negativa
// pelo mesmo motivo da de férias: o que precisa continuar valendo é a AUSÊNCIA
// do formulário.
{
  await p.goto(`${BASE}/planos?${COMP}&colab=5`, { waitUntil: 'networkidle' });
  const formulario = await p.locator('button:text("Adicionar ausência")').count();
  const aponta = /n[ãa]o se lan[çc]a aus[êe]ncia aqui/i.test(await p.evaluate(() => document.body.innerText));
  if (formulario > 0 || !aponta) {
    falhas++;
    console.log(`  FALHOU ausência fora do plano do mês      ${formulario > 0
      ? 'o formulário de adicionar ausência voltou'
      : 'a tela não diz de onde as ausências vêm'}`);
  } else console.log('  ok     ausência fora do plano do mês');
}

// Lançar e desfazer, no painel de ajustes manuais — que é onde essas duas
// operações passaram a viver, juntas. Criar sem poder desfazer é meio caminho:
// quem erra a data precisa de um caminho de volta, e ele não pode ser o mesmo
// botão que apagava também as ausências nascidas de solicitação.
await acao('salvarAusencia no painel de ajustes', `/gerar?${COMP}&etapa=revisar`, async p => {
  const f = p.locator('form:has(button:text-is("Lançar"))');
  await f.locator('input[list]').first().fill(
    await p.evaluate(() => {
      const l = document.querySelector('form input[list]');
      return document.getElementById(l.getAttribute('list')).options[0].value;
    }),
  );
  await f.locator('input[name="inicio"]').fill('2026-11-24');
  await f.locator('button:text-is("Lançar")').click();
}, "select count(*) c from ausencias where tipo='AUSENCIA'");

await acao('removerAusencia no painel de ajustes', `/gerar?${COMP}&etapa=revisar`, async p => {
  // Só o que foi lançado à mão traz botão; o que veio de solicitação aprovada
  // mostra "veio de solicitação" e nenhum caminho de remoção.
  //
  // `text-is`, e não `text`: o painel tem "Remover do dia", que é outra ação —
  // tira a pessoa da escala daquele dia em vez de apagar a ausência — e
  // correspondência por substring pegava ele primeiro.
  //
  // E a linha sai pela DATA, não por `.first()`. A lista mistura férias e
  // ausências ordenadas por início, e a primeira com botão era uma FÉRIAS da
  // massa: o clique removia certo, a contagem de `tipo='AUSENCIA'` não mexia, e
  // a suíte acusava "banco não mudou" sobre uma tela que tinha funcionado.
  await p.locator('li', { hasText: '24/11/2026' })
    .locator('button:text-is("Remover")').first().click();
}, "select count(*) c from ausencias where tipo='AUSENCIA'", MENOS);

// Fixar neste mês as regras herdadas do anterior.
//
// O plano herdado VALE sem ser copiado — é a razão de ele existir —, e por isso
// é fácil esquecer que o botão que o materializa também precisa funcionar. Ele
// é o que congela a decisão: depois dele, mexer no mês de origem não mexe mais
// aqui. A conferência é a contagem de planos do mês, que sai do zero quando a
// cópia acontece de verdade.
await acao('copiarPlanosDoMes', '/gerar?competencia=2026-12-01&etapa=plano', async p => {
  await p.locator('button:text("Fixar aqui as regras")').first().click();
}, "select count(*) c from planos where competencia = '2026-12-01'");

// ── Calendário ────────────────────────────────────────────────
// Mover, travar e lançar ocorrência vivem na gaveta que "Ajustar" abre — a
// linha da tabela voltou a mostrar só o estado.
const ajustar = async (p, i = 0) => {
  await p.locator('button:text("Ajustar")').nth(i).click();
  await p.waitForTimeout(120);
};

await acao('reposicionarAlocacao', `/calendario?${COMP}&vista=dia&dia=2026-11-10`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from alocacoes where travado and data='2026-11-10'");

await acao('alternarTrava', `/calendario?${COMP}&vista=dia&dia=2026-11-11`, async p => {
  await ajustar(p);
  await p.locator('button:text("Travar neste dia")').first().click();
}, "select count(*) c from alocacoes where travado and data='2026-11-11'");

// O lançamento virou um botão por linha, com campos que mudam pelo tipo.
await acao('ocorrência: atraso', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('ATRASO');
  await f.locator('input[name="minutos"]').fill('20');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='ATRASO'");

await acao('ocorrência: falta com dias', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('FALTA_J');
  await f.locator('input[name="dias"]').fill('3');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='FALTA_J' and dias = 3");

await acao('ocorrência: saída antecipada', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('SAIDA_ANTEC');
  await f.locator('input[name="horaSaida"]').fill('15:00');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='SAIDA_ANTEC' and minutos = 120");

await acao('ocorrência: troca com parceiro', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('TROCA');
  await f.locator('select[name="parceiroId"]').selectOption({ index: 1 });
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='TROCA' and parceiro_id is not null");

// ── Geração ───────────────────────────────────────────────────
// A esta altura o `reposicionarAlocacao` lá em cima já deixou uma pendência na
// escala publicada da massa — o cenário de que a regeração precisa dar conta.
const PENDENTES_ANTES_DE_REGERAR = await conta('select count(*) c from alteracoes_pendentes');

// `/gerar` virou um fluxo de quatro etapas, e cada uma tem a sua URL. A tela
// abre sozinha na etapa que o estado do mês sugere — num mês publicado, a
// quarta —, então o roteiro pede a segunda explicitamente, como faria quem
// clica no passo "Gerar a escala".
await acao('regerar mês completo', `/gerar?${COMP}&etapa=gerar`, async p => {
  await p.click('button:text("Regerar o mês")');
}, "select max(versao) c from geracoes where competencia='2026-11-01'", 2);

// Regerar apaga a caixa de saída da versão que sai de cena: ela descreve
// movimentos sobre uma escala que não existe mais, e a tela só lista as
// pendências da versão vigente — o que ficasse seria lixo invisível.
{
  const depois = await conta('select count(*) c from alteracoes_pendentes');
  if (PENDENTES_ANTES_DE_REGERAR === 0) {
    console.log('  ?      regerar limpa a caixa de saída     sem pendência antes; nada a provar');
  } else if (depois > 0) {
    falhas++;
    console.log(`  FALHOU regerar limpa a caixa de saída    sobraram ${depois} pendência(s) órfã(s)`);
  } else console.log(`  ok     regerar limpa a caixa de saída    ${PENDENTES_ANTES_DE_REGERAR} → 0`);
}

// Liberar todas as travas do mês de uma vez.
//
// É o botão que devolve a decisão inteira ao motor, e o único jeito de desfazer
// em lote o que foi travado uma a uma. Nunca tinha sido clicado — e um botão
// destrutivo sem cobertura é o pior tipo de botão sem cobertura.
await acao('liberarTodasAsTravas', `/gerar?${COMP}&etapa=gerar`, async p => {
  await p.locator('button:text("Liberar as")').click();
}, "select count(*) c from pins", 0);

{
  await p.goto(`${BASE}/gerar?${COMP}&etapa=gerar`, { waitUntil: 'networkidle' });
  const recorte = await p.locator('form:has(button:text("Regerar apenas o recorte"))').count();
  console.log(recorte === 0
    ? '  --     regeração parcial               sem porta na tela (a action ainda aceita o recorte)'
    : '  !!     regeração parcial               o recorte voltou à tela — cubra-o aqui');
}

// ── Solicitações ──────────────────────────────────────────────
// Cada decisão consome o cartão em triagem, então cada uma abre o seu.
//
// A área sai do perfil de Ana, e não de `from contas` — desde que a massa tem
// duas áreas, o produto cartesiano gerava também um pedido na área errada,
// apontando para um colaborador que não é dela. O banco recusava pela chave
// composta, e a suíte inteira morria num erro que parecia do app.
await db.query(`insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status)
  select p.conta_id, 3, 'TROCA_UNIDADE', '2026-11-19', 'Pedido de teste ' || g, 'TRIAGEM'
  from perfis p, generate_series(1, 2) g
  where p.id = $1`, [ANA]);

await acao('decidir: encaminhar', '/solicitacoes', async p => {
  await p.locator('button:text("Encaminhar ao gestor")').first().click();
}, "select count(*) c from solicitacoes where status='GESTOR'", 2);

await acao('decidir: enviar para a fila', '/solicitacoes', async p => {
  await p.locator('button:text-is("Lista de espera")').first().click();
}, "select count(*) c from solicitacoes where status='FILA'");

await acao('decidir: recusar', '/solicitacoes', async p => {
  await p.locator('button:text-is("Recusar")').first().click();
  await p.locator('input[name="motivo"]').fill('Sem cobertura na data pedida.');
  await p.locator('button:text("Confirmar recusa")').click();
}, "select count(*) c from solicitacoes where status='RECUSADA'");

// Promover quem estava na fila.
//
// A lista de espera só tem razão de existir se alguém sair dela, e essa saída
// nunca tinha sido exercitada — a suíte enfileirava e parava ali. Vale o pedido
// que o passo da fila acabou de colocar lá.
await acao('decidir: promover da fila', '/solicitacoes?aba=fila', async p => {
  await p.locator('button:text("Promover ao gestor")').first().click();
}, "select count(*) c from solicitacoes where status='FILA'", MENOS);

// Aprovar direto, sem passar pelo gestor.
//
// É prerrogativa exclusiva do Planejamento, e a única aprovação que ainda
// aplica o efeito na escala na hora — ele é quem a RLS deixa escrever em `pins`
// e `ausencias`. Por isso a conferência não é o status: é a TRAVA no dia, que é
// o que distingue "encerrou o pedido" de "encerrou e mexeu na escala".
await db.query(`insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status, unidade_desejada_id)
  select p.conta_id, 3, 'TROCA_UNIDADE', '2026-11-21', 'Aprovação direta de teste', 'TRIAGEM',
         (select id from unidades where conta_id = p.conta_id order by id limit 1)
  from perfis p where p.id = $1`, [ANA]);

await acao('decidir: aprovar direto na triagem', '/solicitacoes', async p => {
  await p.locator('button:text-is("Aprovar")').first().click();
}, "select count(*) c from pins where colaborador_id = 3 and data = '2026-11-21'", 1);

// Depois de encaminhada, o Planejamento perde o botão: a decisão é do gestor.
{
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  // Só o cartão que ESTÁ com o gestor: contar os botões da página inteira
  // passou a somar os "Aprovar" legítimos dos cartões em triagem, e a acusar
  // uma regra que continuava valendo.
  const comOGestor = p.locator('section.esc-card').filter({ hasText: 'Com o gestor' });
  const temBotao = await comOGestor.getByRole('button', { name: /^Aprovar$/ }).count();
  const explica = /a decisão agora é do gestor/i.test(await comOGestor.first().innerText());
  if (temBotao > 0 || !explica) {
    falhas++;
    console.log(`  FALHOU planejamento não decide depois     botões=${temBotao} explicação=${explica}`);
  } else console.log('  ok     planejamento não decide depois');
}

// Uma solicitação de férias esperando o gestor, com um colega já de férias no
// mesmo período: é o contexto que a tela precisa mostrar antes da decisão.
await db.query(`insert into solicitacoes (conta_id, colaborador_id, tipo, data, data_fim, detalhe, status, opcao_ferias)
  select p.conta_id, 3, 'FERIAS', '2026-12-01', '2026-12-30', 'Férias de fim de ano', 'GESTOR', '30'
  from perfis p where p.id = $1`, [ANA]);

como(RICARDO);
{
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  const texto = await p.evaluate(() => document.body.innerText);
  // A massa tem Carla de férias em dezembro, e o roteiro lançou mais uma acima.
  const mostrou = /pessoa\(s\) da equipe já estão fora nesse período|Ninguém mais da equipe está fora/.test(texto);
  if (!mostrou) {
    falhas++;
    console.log('  FALHOU férias sobrepostas p/ o gestor     nada sobre quem mais está fora');
  } else console.log('  ok     férias sobrepostas p/ o gestor');
}

// Cresceu, e não "é 2": desde que o roteiro passou a PROMOVER alguém da fila,
// quantos restam ali depende de quantos entraram e saíram antes deste passo.
// Número cravado num contador que outros passos mexem é armadilha para o
// próximo que acrescentar um caso no meio.
await acao('gestor manda para a fila', '/solicitacoes', async p => {
  await p.locator('button:text-is("Lista de espera")').first().click();
}, "select count(*) c from solicitacoes where status='FILA'", MAIS);

// A aprovação do gestor não encerra mais um pedido que mexe na escala: manda
// para `IMPLANTAR`, e quem lança os dias é o Planejamento. A troca do alvo desta
// conferência — de APROVADA para IMPLANTAR — É o teste da regra: escrever em
// `pins` e `ausencias` é privilégio do Planejamento na RLS, e a aprovação que ia
// direto a APROVADA falhava calada ali, deixando o pedido marcado como aplicado
// sobre uma escala intacta.
await acao('gestor aprova → a implantar', '/solicitacoes', async p => {
  await p.locator('button:text("Aprovar")').first().click();
}, "select count(*) c from solicitacoes where status='IMPLANTAR'");

// O gestor também recusa, e a recusa exige motivo — é a única decisão que o
// sistema não deixa tomar em silêncio, porque é a que a pessoa vai contestar.
await db.query(`insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status)
  select p.conta_id, 3, 'AJUSTE_PONTO', '2026-11-23', 'Recusa de teste', 'GESTOR'
  from perfis p where p.id = $1`, [ANA]);

await acao('gestor recusa com motivo', '/solicitacoes', async p => {
  const cartao = p.locator('section.esc-card').filter({ hasText: 'Recusa de teste' });
  await cartao.locator('button:text-is("Recusar")').click();
  await p.locator('input[name="motivo"]').fill('Ponto já conferido pelo RH nesta data.');
  await p.locator('button:text("Confirmar recusa")').click();
}, "select count(*) c from solicitacoes where status='RECUSADA' and motivo_recusa <> ''", MAIS);

// ── Troca de plantão: o convite passa PRIMEIRO pelo colega ────
//
// O caminho `AGUARDA_PARCEIRO` existia na máquina de estados desde o começo e
// nunca tinha sido percorrido por teste nenhum — nem o aceite, nem a recusa.
// São as duas únicas decisões que um COLABORADOR toma no sistema, e ninguém
// além dele pode tomá-las: o servidor confere que quem responde é o convidado.
{
  const [{ id: convidado }] = (await db.query(
    `select id from colaboradores where perfil_id = $1`, [FELIPE])).rows;

  for (const [rotulo, botao, alvo] of [
    ['parceiro aceita a troca', 'Aceitar a troca', 'TRIAGEM'],
    ['parceiro recusa a troca', 'Recusar a troca', 'RECUSADA'],
  ]) {
    const marca = `Convite ${alvo}`;
    await db.query(`insert into solicitacoes
        (conta_id, colaborador_id, parceiro_id, tipo, data, detalhe, status, aceite_parceiro)
      select p.conta_id, 5, $2, 'TROCA_HORARIO', '2026-11-25', $3, 'AGUARDA_PARCEIRO', null
      from perfis p where p.id = $1`, [ANA, convidado, marca]);

    como(FELIPE);
    await acao(rotulo, '/solicitacoes', async p => {
      const cartao = p.locator('section.esc-card').filter({ hasText: marca });
      await cartao.locator(`button:text("${botao}")`).click();
      if (botao.startsWith('Recusar')) {
        await p.locator('input[name="motivo"]').fill('Não posso assumir esse plantão.');
        await p.locator('button:text("Confirmar recusa")').click();
      }
    }, `select count(*) c from solicitacoes where detalhe = '${marca}' and status = '${alvo}'`, 1);
  }
}

// E o pedido que o próprio colaborador abre, que é o caminho de entrada mais
// usado do sistema inteiro e só era exercitado pela ponta do Planejamento.
como(FELIPE);
await acao('colaborador abre solicitação', '/solicitacoes?abrir=1', async p => {
  await p.selectOption('select[name="tipo"]', 'AJUSTE_PONTO');
  await p.fill('input[name="data"]', '2026-11-27');
  await p.fill('textarea[name="detalhe"]', 'Esqueci de bater o ponto na saída.');
  await p.locator('button:text("Enviar solicitação")').click();
}, "select count(*) c from solicitacoes where tipo='AJUSTE_PONTO' and data='2026-11-27' and status='TRIAGEM'", 1);

// ── Colaboradores ─────────────────────────────────────────────
como(ANA);
await acao('salvarColaborador', '/colaboradores?novo=1', async p => {
  await p.fill('#editor-colaborador input[name="nome"]', 'Paula Rezende');
  await p.fill('#editor-colaborador input[name="matricula"]', '2001');
  await p.selectOption('#editor-colaborador select[name="equipeId"]', { index: 1 });
  await p.selectOption('#editor-colaborador select[name="unidadeBaseId"]', { index: 1 });
  await p.fill('#editor-colaborador input[name="admissao"]', '2026-01-05');
  await p.click('#editor-colaborador button:text("Salvar colaborador")');
}, "select count(*) c from colaboradores");

// ── Usuários ──────────────────────────────────────────────────
como(ANA);
await acao('convidarUsuario', '/usuarios', async p => {
  const f = p.locator('form:has(button:text("Criar acesso"))');
  await f.locator('input[name="nome"]').fill('Paula Rezende');
  await f.locator('input[name="email"]').fill('paula.rezende@saolucas.com');
  await f.locator('button:text("Criar acesso")').click();
}, null);

// Trocar o papel de alguém, e bloquear/liberar o acesso.
//
// As duas nunca tinham sido exercitadas, e são as que mais doem quando falham
// caladas: um papel que não muda deixa a pessoa sem as telas de que precisa, e
// um bloqueio que não pega deixa entrar quem já saiu da empresa.
//
// O alvo é escolhido pelo BANCO e endereçado por id, não "a primeira linha da
// tabela": a lista é ordenada por nome, e uma pessoa cadastrada num passo
// anterior entra no meio dela. Mirar por posição é como um roteiro passa a
// testar outra coisa sem ninguém perceber.
const [{ id: ALVO_PAPEL }] = (await db.query(
  `select id from perfis where papel = 'colaborador' and conta_id is not null order by id limit 1`)).rows;

await acao('mudarPapel', '/usuarios', async p => {
  const f = p.locator(`form:has(input[value="${ALVO_PAPEL}"]):has(select[name="papel"])`);
  await f.locator('select[name="papel"]').selectOption('gestor');
  await f.locator('button:text("Salvar")').click();
}, `select count(*) c from perfis where id = '${ALVO_PAPEL}' and papel = 'gestor'`, 1);

await acao('alternarBloqueio (bloquear)', '/usuarios', async p => {
  const f = p.locator(`form:has(input[value="${ALVO_PAPEL}"]):has(button:text("Bloquear"))`);
  await f.locator('button:text("Bloquear")').click();
}, `select count(*) c from perfis where id = '${ALVO_PAPEL}' and bloqueado`, 1);

await acao('alternarBloqueio (liberar)', '/usuarios', async p => {
  const f = p.locator(`form:has(input[value="${ALVO_PAPEL}"]):has(button:text("Liberar"))`);
  await f.locator('button:text("Liberar")').click();
}, `select count(*) c from perfis where id = '${ALVO_PAPEL}' and bloqueado`, 0);

// Devolve o papel: os passos seguintes contam com a massa como ela foi semeada,
// e um colaborador virado gestor no meio do caminho muda o que o gestor vê.
await db.query(`update perfis set papel = 'colaborador' where id = $1`, [ALVO_PAPEL]);

// ── Mural ─────────────────────────────────────────────────────
// Anexos de mentira, mas com o cabeçalho de verdade: o CHECK da tabela e o
// filtro do formulário olham o MIME, e um arquivo vazio não exercita o bytea.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

como(ANA);
await acao('publicarComunicado (com anexos)', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Manutenção do ar-condicionado');
  await p.fill('textarea[name="corpo"]', 'O Morumbi fica sem climatização na quinta pela manhã.');
  await p.selectOption('select[name="publico"]', 'colaboradores');
  await p.setInputFiles('input[name="anexos"]', [
    { name: 'aviso.png', mimeType: 'image/png', buffer: PNG },
    { name: 'circular.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicado_anexos");

// O anexo tem que voltar byte a byte: bytea que passa pelo hex errado vira um
// PNG que o navegador recusa, e a tela não denuncia nada.
{
  const { rows } = await db.query(
    "select id, tamanho, octet_length(conteudo) real, tipo from comunicado_anexos order by id desc limit 2");
  const ruim = rows.find(r => Number(r.tamanho) !== Number(r.real));
  if (ruim) { falhas++; console.log(`  FALHOU anexo íntegro no banco            #${ruim.id}: ${ruim.tamanho} enviados, ${ruim.real} gravados`); }
  else {
    const r = await p.request.get(`${BASE}/mural/anexo/${rows[0].id}`);
    const corpo = Buffer.from(await r.body());
    const ok = r.status() === 200 && corpo.length === Number(rows[0].tamanho)
      && r.headers()['content-type'] === rows[0].tipo;
    if (!ok) { falhas++; console.log(`  FALHOU rota do anexo                     ${r.status()} ${corpo.length}B, esperado ${rows[0].tamanho}B ${rows[0].tipo}`); }
    else console.log(`  ok     rota do anexo                     ${corpo.length}B ${rows[0].tipo}`);
  }
}

await acao('publicarComunicado (gestores)', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Fechamento do mês');
  await p.fill('textarea[name="corpo"]', 'Enviem os ajustes até sexta.');
  await p.selectOption('select[name="publico"]', 'gestores');
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicados where publico='gestores'");

// Comunicado para gestores não pode aparecer para colaborador: é aqui que a
// policy vale ou não vale, e a consulta da tela não repete o filtro.
como(FELIPE);
{
  await p.goto(`${BASE}/mural`, { waitUntil: 'networkidle' });
  const texto = await p.evaluate(() => document.body.innerText);
  const vazou = /Fechamento do mês/.test(texto);
  const viuOSeu = /Manutenção do ar-condicionado/.test(texto);
  if (vazou || !viuOSeu) {
    falhas++;
    console.log(`  FALHOU recorte do mural p/ colaborador    ${vazou ? 'viu o comunicado dos gestores' : 'não viu o comunicado da equipe dele'}`);
  } else console.log('  ok     recorte do mural p/ colaborador');
}

// O gestor publica para a equipe; o seletor de público nem aparece para ele.
como(RICARDO);
await acao('gestor publica p/ a equipe', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Reunião de time na terça');
  await p.fill('textarea[name="corpo"]', 'Sala 3, às 9h.');
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicados where autor_nome = 'Ricardo Matos'");

{
  const { rows } = await db.query(
    "select publico, equipe_id from comunicados where autor_nome = 'Ricardo Matos'");
  const errado = rows.find(r => r.publico !== 'colaboradores' || r.equipe_id === null);
  if (errado) { falhas++; console.log(`  FALHOU gestor preso à própria equipe     publico=${errado.publico} equipe=${errado.equipe_id}`); }
  else console.log('  ok     gestor preso à própria equipe');
}

// ── Alteração de escala publicada avisa quem depende dela ─────
// A regeração lá em cima deixou a versão nova em rascunho, e rascunho não
// avisa ninguém de propósito. Publicar aqui é o que põe o cenário em pé.
como(ANA);
await acao('publicar para a equipe', `/gerar?${COMP}&etapa=publicar`, async p => {
  await p.click('button:text("Publicar a escala")');
}, "select count(*) c from geracoes where atual and status='publicada' and competencia='2026-11-01'", 1);

// A massa já traz avisos de alteração; o que interessa aqui é o que sai DAGORA
// em diante.
const AVISOS_ANTES = await conta("select count(*) c from avisos where titulo like 'Escala alterada%'");
let origem18 = '';

await acao('mover 1 (nada é avisado ainda)', `/calendario?${COMP}&vista=dia&dia=2026-11-17`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from alteracoes_pendentes", 1);

await acao('mover 2 na mesma leva', `/calendario?${COMP}&vista=dia&dia=2026-11-18`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Mover"))').first();
  const sel = f.locator('select[name="destino"]');
  origem18 = await sel.inputValue();
  // Um destino diferente do atual: mover alguém para onde ela já está não é
  // alteração, e o sistema (certo) não cria pendência nenhuma.
  const opcoes = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
  await sel.selectOption(opcoes.find(v => v !== origem18));
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from alteracoes_pendentes", 2);

// O ponto todo do lote: mexer não avisa. Um aviso escapando aqui é um
// "sua escala mudou" no meio de um trabalho inacabado.
{
  const agora = await conta("select count(*) c from avisos where titulo like 'Escala alterada%'");
  if (agora > AVISOS_ANTES) {
    falhas++;
    console.log(`  FALHOU mexer não avisa                   ${agora - AVISOS_ANTES} aviso(s) saíram antes de publicar`);
  } else console.log('  ok     mexer não avisa');
}

// Voltar ao ponto de partida desfaz a pendência: não há o que comunicar sobre
// um dia que voltou a ser o que era.
await acao('voltar atrás limpa a pendência', `/calendario?${COMP}&vista=dia&dia=2026-11-18`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption(origem18);
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from alteracoes_pendentes", 1);

// A conferência roda sobre o que está no banco, não sobre a lembrança da
// geração: a tela precisa falar do estado atual.
{
  await p.goto(`${BASE}/calendario?${COMP}`, { waitUntil: 'networkidle' });
  const texto = await p.evaluate(() => document.body.innerText);
  const temBarra = /alteração\(ões\) que a equipe ainda não recebeu/.test(texto);
  const temEstado = /no estado atual/i.test(texto);
  if (!temBarra || !temEstado) {
    falhas++;
    console.log(`  FALHOU barra de alterações pendentes     barra=${temBarra} conferência=${temEstado}`);
  } else console.log('  ok     barra de alterações pendentes');
}

await acao('publicar alterações avisa a leva', `/calendario?${COMP}`, async p => {
  await p.locator('select[name="alcance"]').selectOption('todos');
  await p.locator('button:text("Publicar alterações")').click();
}, "select count(*) c from alteracoes_pendentes", 0);

{
  const agora = await conta("select count(*) c from avisos where titulo like 'Escala alterada%'");
  if (agora <= AVISOS_ANTES) {
    falhas++;
    console.log('  FALHOU publicar alterações avisa         nenhum aviso saiu');
  } else console.log(`  ok     publicar alterações avisa         ${agora - AVISOS_ANTES} aviso(s)`);
}

// O gestor também altera depois de publicada, e o log fica para os dois.
como(RICARDO);
await acao('gestor move escala publicada', `/calendario?${COMP}&vista=dia&dia=2026-11-19`, async p => {
  await ajustar(p);
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from logs where acao = 'Alocação ajustada'");

await acao('descartar sem avisar', `/calendario?${COMP}`, async p => {
  await p.locator('button:text("Não avisar")').click();
}, "select count(*) c from alteracoes_pendentes", 0);

// ── Sino e contadores ─────────────────────────────────────────
// O sino passou a mostrar só o que falta ler, e abrir um item tira ELE da
// lista. A regressão que isto guarda: abrir um aviso esvaziar a lista inteira,
// que era o efeito de marcar tudo com um carimbo só.
como(FELIPE);
{
  const abrirSino = async () => {
    await p.goto(`${BASE}/minha-escala?${COMP}`, { waitUntil: 'networkidle' });
    const sino = p.locator('header details summary:visible').first();
    const badge = (await sino.innerText()).trim().replace(/\s+/g, '');
    await sino.click();
    await p.waitForTimeout(250);
    // Só os itens: o botão "Marcar como lidas" também é um submit dentro do
    // painel, e contá-lo fazia a lista parecer ter um item a mais que o sino.
    return { badge, itens: await p.locator('header details:visible li form button[type=submit]').count() };
  };

  const antes = await abrirSino();
  if (antes.itens < 2) {
    falhas++;
    console.log(`  FALHOU sino com o que ler                 ${antes.itens} item(ns); o cenário precisa de 2+`);
  } else {
    await p.locator('header details:visible li form button[type=submit]').first().click();
    await p.waitForLoadState('networkidle');
    const depois = await abrirSino();
    if (depois.itens !== antes.itens - 1) {
      falhas++;
      console.log(`  FALHOU abrir tira só o item aberto       ${antes.itens} → ${depois.itens}, esperado ${antes.itens - 1}`);
    } else {
      console.log(`  ok     abrir tira só o item aberto       ${antes.itens} → ${depois.itens}`);
    }
    // O sino para de contar em "9+" — dez avisos e cem avisos dizem a mesma
    // coisa a quem olha, e o número inteiro só alargaria a bolinha. Comparar
    // com o tamanho cru da lista acusava divergência onde havia truncamento.
    const esperadoNoSino = depois.itens > 9 ? '9+' : String(depois.itens);
    if (depois.badge !== esperadoNoSino) {
      falhas++;
      console.log(`  FALHOU contador bate com a lista         sino="${depois.badge}", esperado "${esperadoNoSino}" (lista=${depois.itens})`);
    } else console.log(`  ok     contador bate com a lista         ${depois.badge}`);

    // "Marcar como lidas" é o corte em massa, e é a outra metade do sino: abrir
    // um item por vez tira um; este botão tira todos. Nunca tinha sido clicado.
    //
    // Antes de clicar, a massa é trazida para o passado. Ela encena novembro de
    // 2026 com "hoje" em agosto, então os avisos e eventos semeados estão no
    // FUTURO — e o botão carimba `now()`, que não alcança o que ainda não
    // aconteceu. Em produção isso não existe: evento nenhum nasce com data
    // futura. Deixar a ficção no lugar faria o teste medir o calendário do
    // cenário em vez da regra, e a regra é: o que já aconteceu, some.
    await db.query("update solicitacao_eventos set em = least(em, now() - interval '1 minute')");
    await db.query("update avisos set criado_em = least(criado_em, now() - interval '1 minute')");
    const carimboAntes = (await db.query(
      'select notificacoes_vistas_em v from perfis where id = $1', [FELIPE])).rows[0].v;
    await p.locator('header details:visible button:text("Marcar como lidas")').click();

    // Espera o CARIMBO, não um relógio. A ação grava, revalida e redireciona, e
    // `networkidle` volta antes de tudo isso terminar — medir ali dava "sobraram
    // 10" numa gravação que estava a caminho. Um `waitForTimeout` generoso
    // esconderia o mesmo problema atrás de um número inventado.
    for (let i = 0; i < 40; i++) {
      const agora = (await db.query(
        'select notificacoes_vistas_em v from perfis where id = $1', [FELIPE])).rows[0].v;
      if (String(agora) !== String(carimboAntes)) break;
      await p.waitForTimeout(100);
    }

    const zerado = await abrirSino();
    if (zerado.itens !== 0) {
      falhas++;
      console.log(`  FALHOU marcar todas esvazia o sino       sobraram ${zerado.itens}`);
    } else console.log('  ok     marcar todas esvazia o sino');
  }
}

// O contador do mural conta o que chegou desde a última visita, e zera quando
// a pessoa abre — sem depender do sino, que é outra caixa.
{
  const badgeMural = async () => {
    await p.goto(`${BASE}/minha-escala?${COMP}`, { waitUntil: 'networkidle' });
    // O link do menu carrega a competência na query, então casar a href exata
    // não funciona.
    const item = p.locator('a[href^="/mural"]:visible').first();
    const t = await item.innerText().catch(() => 'Mural');
    return Number(t.replace(/[^0-9]/g, '') || 0);
  };

  await db.query("update perfis set mural_visto_em = '1970-01-01Z' where id = $1", [FELIPE]);
  const comNovidade = await badgeMural();
  await p.goto(`${BASE}/mural`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const depoisDeVer = await badgeMural();

  if (comNovidade === 0) {
    falhas++;
    console.log('  FALHOU contador do mural                 não contou comunicado novo');
  } else if (depoisDeVer !== 0) {
    falhas++;
    console.log(`  FALHOU mural zera ao ser aberto          ${comNovidade} → ${depoisDeVer}`);
  } else console.log(`  ok     contador do mural                 ${comNovidade} → 0 ao abrir`);
}

// ── Remoção ───────────────────────────────────────────────────
como(ANA);
{
  const antes = await conta('select count(*) c from comunicados');
  await acao('removerComunicado', '/mural', async p => {
    await p.locator('button:text("Remover")').first().click();
  }, 'select count(*) c from comunicados', antes - 1);
}

// ── Console de áreas ──────────────────────────────────────────
como(HELENA);
{
  const nova = `Área de Teste ${Date.now().toString().slice(-6)}`;
  await acao('criarArea', '/areas', async p => {
    // O formulário de criação é o último da página; os de cima são o de
    // renomear e o de somar administrador de cada área já existente.
    const f = p.locator('form').last();
    await f.locator('input[name="nome"]').fill(nova);
    await f.locator('input[name="adminNome"]').fill('Teste Admin');
    await f.locator('input[name="adminEmail"]').fill(`admin.${Date.now()}@teste.com`);
    await f.locator('button[type="submit"]').click();
  }, 'select count(*) c from contas');

  // A área nasce COM administrador: se o login falhasse, a criação seria
  // desfeita, e conferir só a conta deixaria passar exatamente esse caso.
  const orfas = await conta(`
    select count(*) c from contas c
    where not exists (select 1 from perfis p where p.conta_id = c.id and p.papel = 'admin_local')`);
  if (orfas > 0) {
    falhas++;
    console.log(`  FALHOU área nasce com administrador      ${orfas} área(s) sem administrador`);
  } else console.log('  ok     área nasce com administrador      nenhuma órfã');

  await acao('adicionarAdminLocal', '/areas', async p => {
    await p.locator('summary:has-text("Administrar esta área")').first().click();
    const f = p.locator('form:has(input[name="adminEmail"])').first();
    await f.locator('input[name="adminNome"]').fill('Segundo Admin');
    await f.locator('input[name="adminEmail"]').fill(`segundo.${Date.now()}@teste.com`);
    await f.locator('button[type="submit"]').click();
  }, "select count(*) c from perfis where papel = 'admin_local'");

  await acao('alternarArea (desativar)', '/areas', async p => {
    await p.locator('button:text("Desativar")').first().click();
  }, 'select count(*) c from contas where ativa = false');

  // Desativar tem de valer para quem já está dentro, e não só para logins
  // novos: uma aba aberta continuaria operando a escala de uma área fora do ar.
  {
    const [{ id: areaOff }] = (await db.query('select id from contas where ativa = false limit 1')).rows;
    const [{ id: dentro }] = (await db.query(
      "select id from perfis where conta_id = $1 order by papel limit 1", [areaOff])).rows;
    como(dentro);
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const parou = new URL(p.url()).pathname;
    if (parou !== '/login') {
      falhas++;
      console.log(`  FALHOU área desativada barra quem entra  parou em ${parou}`);
    } else console.log('  ok     área desativada barra quem entra  devolvido ao login');
    como(HELENA);
  }

  await acao('alternarArea (reativar)', '/areas', async p => {
    await p.locator('button:text("Reativar")').first().click();
  }, 'select count(*) c from contas where ativa = false', 0);

  await acao('renomearArea', '/areas', async p => {
    await p.locator('summary:has-text("Administrar esta área")').first().click();
    const f = p.locator('form:has(button:text("Renomear"))').first();
    await f.locator('input[name="nome"]').fill('Área Renomeada');
    await f.locator('button:text("Renomear")').click();
  }, "select count(*) c from contas where nome = 'Área Renomeada'", 1);
}

// ── Administrador da Área ─────────────────────────────────────
como(MARCOS);
{
  await acao('admin da área cria Planejamento', '/usuarios', async p => {
    const f = p.locator('form:has(select[name="papel"]):has(input[name="email"])').last();
    await f.locator('input[name="nome"]').fill('Planejadora Nova');
    await f.locator('input[name="email"]').fill(`plan.${Date.now()}@saolucas.com`);
    await f.locator('select[name="papel"]').selectOption('planejamento');
    await f.locator('button[type="submit"]').click();
  }, "select count(*) c from perfis where papel = 'planejamento'");

  // Aba explícita, e o formulário escolhido pelo BOTÃO: `codigo` sumiu da tela
  // na 0018 (quem o gera é o banco), e era por ele que este roteiro achava o
  // formulário certo.
  await acao('admin da área cadastra unidade', '/parametros?aba=unidades&unidade=novo', async p => {
    const f = p.locator('form:has(button:text("Adicionar unidade"))');
    await f.locator('input[name="nome"]').fill('Unidade da Área');
    await f.locator('input[name="sigla"]').fill('UDA');
    await f.locator('button:text("Adicionar unidade")').click();
  }, 'select count(*) c from unidades');
}

// ── Encerrar o mês, por último ────────────────────────────────
//
// Encerrar é irreversível — não existe reabrir, nem na tela nem na action —, e
// a partir daí o mês recusa ajuste, ocorrência e solicitação nova. Por isso é o
// derradeiro passo do roteiro: posto no meio, ele derrubaria tudo o que viesse
// depois, e a suíte culparia as telas erradas.
como(ANA);
await acao('encerrar o mês', `/calendario?${COMP}`, async p => {
  await p.locator('button:text("Encerrar o mês")').click();
}, "select count(*) c from geracoes where atual and competencia='2026-11-01' and status='encerrada'", 1);

// E o mês encerrado realmente fecha a porta: a tentativa de mexer volta com
// erro, em vez de gravar em silêncio sobre um registro que já virou histórico.
{
  await p.goto(`${BASE}/calendario?${COMP}&vista=dia&dia=2026-11-19`, { waitUntil: 'networkidle' });
  const texto = await p.evaluate(() => document.body.innerText);
  const fechado = /encerrad/i.test(texto);
  const semAjuste = await p.locator('button:text("Mover")').count();
  if (!fechado || semAjuste > 0) {
    falhas++;
    console.log(`  FALHOU mês encerrado não recebe ajuste   aviso=${fechado} botões de mover=${semAjuste}`);
  } else console.log('  ok     mês encerrado não recebe ajuste');
}

await b.close();
await db.end();
console.log(falhas ? `\n${falhas} ação(ões) com problema` : '\ntodas as ações gravaram sem erro');
