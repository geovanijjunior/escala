/**
 * Auditoria das Server Actions: nenhuma entra sem apresentar documento.
 *
 *   node supabase/tests/autorizacao.mjs
 *
 * Toda função exportada de um `actions-*.ts` é um ENDPOINT. O Next publica uma
 * rota para cada uma, e ela aceita POST de qualquer um que tenha o id dela —
 * esconder o botão na tela não fecha nada. A RLS é a trava final e continua
 * valendo, mas ela responde "não vejo esta linha", não "você não podia pedir
 * isto": uma action sem guarda de papel deixa um gestor chamar o que é do
 * Planejamento e receber um erro de banco em vez de uma recusa.
 *
 * O teste é estático de propósito. Exercitar as trinta e poucas actions pelo
 * navegador, em cada um dos cinco papéis, é lento e cobre mal; ler o texto
 * cobre todas, sempre, e falha no momento em que alguém acrescenta a
 * trigésima-sexta sem a guarda.
 *
 * Duas listas explícitas embaixo dizem o que é exceção e POR QUE. Uma action
 * nova não entra nelas sozinha — é o ponto.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(raiz, 'src', 'app');

/**
 * Actions abertas a quem não tem sessão, com a razão de cada uma.
 *
 * São duas, e nenhuma toca dado de área: `entrar` é o login — exigir sessão
 * para entrar seria um círculo — e `sair` derruba a sessão de quem a estiver
 * usando, o que é inofensivo mesmo sem nenhuma.
 */
const PUBLICAS = {
  'actions-sessao.ts': ['entrar', 'sair'],
};

/**
 * Actions que abrem sessão e não checam papel, porque agem sobre o próprio
 * usuário e mais nada.
 *
 * Não é "o que falta fazer": é o que qualquer pessoa logada pode legitimamente
 * fazer sobre si mesma. As duas escrevem carimbo de leitura amarrado a
 * `sessao.usuario.id`; o recorte é o dono do dado, e quem o garante é a RLS
 * (`notificacoes_lidas_propria` compara com `auth.uid()`). Papel não entra.
 */
const SOBRE_SI = {
  'actions-notificacoes.ts': ['marcarNotificacoesLidas', 'abrirNotificacao'],
};

/**
 * Actions cuja guarda depende do DADO, não só do papel.
 *
 * Quem decide uma solicitação é o gestor DAQUELA equipe, e isso só se sabe
 * depois de lê-la. A checagem existe — só não cabe numa chamada no topo.
 */
const GUARDA_PROPRIA = {
  'actions-solicitacoes.ts': ['decidirSolicitacao'],
};

const ABRE_SESSAO = /\bgetSessao\s*\(|\bgetSessaoGeral\s*\(/;

/**
 * O que conta como checagem de papel.
 *
 * Além das funções `exigir*`, duas formas que o código usa e que uma primeira
 * versão deste teste não reconhecia — apontando catorze brechas que não
 * existiam:
 *
 * - `getSessaoGeral()` já É a guarda do Administrador Geral: ela redireciona
 *   quem não tem esse papel antes de devolver a sessão. É por isso que as
 *   actions de área não chamam mais nada.
 * - `sessao.papel` comparado na mão, que é o caminho de quem precisa DEVOLVER
 *   um relatório de erro em vez de redirecionar (`conferirPlanilha`) ou de
 *   quem trata o papel como variação e não como porta (`abrirSolicitacao`, em
 *   que só o Planejamento pode abrir em nome de outra pessoa).
 */
const EXIGE_PAPEL = new RegExp([
  /\bexigir[A-Z]\w*\s*\(/, /\bpodeEditarEscala\s*\(/, /\bpodeAprovar\s*\(/,
  /\bpodeCadastrar\s*\(/, /\behPlanejamento\s*\(/, /\bpodeVerEquipe\s*\(/,
  /\bgetSessaoGeral\s*\(/, /\bsessao\.papel\b/,
].map(r => r.source).join('|'));

/** Corta o arquivo em funções exportadas: da assinatura até a próxima. */
function actionsDe(texto) {
  const marca = /^export\s+async\s+function\s+(\w+)\s*\(/gm;
  const achados = [];
  let m;
  while ((m = marca.exec(texto)) !== null) achados.push({ nome: m[1], inicio: m.index });
  return achados.map((a, i) => ({
    nome: a.nome,
    corpo: texto.slice(a.inicio, achados[i + 1]?.inicio ?? texto.length),
  }));
}

const arquivos = readdirSync(dir).filter(f => /^actions-.*\.ts$/.test(f)).sort();
let total = 0, falhas = 0, isentas = 0;
const ok = t => console.log(`  \x1b[32mok\x1b[0m: ${t}`);
const erro = t => { console.log(`  \x1b[31mFALHOU\x1b[0m: ${t}`); falhas++; };

console.log('\n\x1b[1m── Toda Server Action abre sessão e checa papel\x1b[0m\n');

for (const arquivo of arquivos) {
  const texto = readFileSync(join(dir, arquivo), 'utf8');
  if (!/^'use server'/m.test(texto)) { erro(`${arquivo} não declara 'use server'`); continue; }

  const publicas = new Set(PUBLICAS[arquivo] ?? []);
  const sobreSi = new Set(SOBRE_SI[arquivo] ?? []);
  const guardaPropria = new Set(GUARDA_PROPRIA[arquivo] ?? []);
  const problemas = [];

  for (const { nome, corpo } of actionsDe(texto)) {
    total++;
    if (publicas.has(nome)) { isentas++; continue; }
    if (!ABRE_SESSAO.test(corpo)) {
      problemas.push(`${nome}: não abre sessão — o endpoint responde a qualquer um`);
      continue;
    }
    if (EXIGE_PAPEL.test(corpo)) continue;
    if (sobreSi.has(nome) || guardaPropria.has(nome)) { isentas++; continue; }
    problemas.push(`${nome}: abre sessão mas não checa papel, e não está declarada como exceção`);
  }

  if (problemas.length === 0) ok(`${arquivo} — ${actionsDe(texto).length} action(s)`);
  else for (const p of problemas) erro(`${arquivo} · ${p}`);
}

// As exceções precisam apontar para código que existe: uma lista que envelhece
// silenciosamente é pior que lista nenhuma, porque continua parecendo revisada.
console.log('\n\x1b[1m── As exceções declaradas ainda existem\x1b[0m\n');
for (const [arquivo, nomes] of [
  ...Object.entries(PUBLICAS), ...Object.entries(SOBRE_SI), ...Object.entries(GUARDA_PROPRIA),
]) {
  const texto = readFileSync(join(dir, arquivo), 'utf8');
  const reais = new Set(actionsDe(texto).map(a => a.nome));
  const fantasmas = nomes.filter(n => !reais.has(n));
  if (fantasmas.length === 0) ok(`${arquivo} — ${nomes.length} exceção(ões) conferem`);
  else erro(`${arquivo} · exceção para action inexistente: ${fantasmas.join(', ')}`);
}

// A guarda "própria" precisa mesmo comparar com alguém. Uma action nessa lista
// que não mencione o dono do dado está isenta à toa.
console.log('\n\x1b[1m── As guardas próprias comparam com o dono do dado\x1b[0m\n');
for (const [arquivo, nomes] of Object.entries(GUARDA_PROPRIA)) {
  const texto = readFileSync(join(dir, arquivo), 'utf8');
  for (const { nome, corpo } of actionsDe(texto)) {
    if (!nomes.includes(nome)) continue;
    if (/sessao\.(usuario|colaborador|papel)|gerenciadas|equipesDoGestor|colaborador_id/.test(corpo)) {
      ok(`${nome} confere o dono antes de agir`);
    } else {
      erro(`${arquivo} · ${nome} está isenta de papel mas não compara com o dono do dado`);
    }
  }
}

// A isenção "age só sobre si" precisa ser verdade no texto: uma action que
// entre nessa lista sem amarrar a escrita ao usuário da sessão estaria isenta
// justamente do que a torna segura.
console.log('\n\x1b[1m── As actions "sobre si" amarram a escrita ao usuário da sessão\x1b[0m\n');
for (const [arquivo, nomes] of Object.entries(SOBRE_SI)) {
  const texto = readFileSync(join(dir, arquivo), 'utf8');
  for (const { nome, corpo } of actionsDe(texto)) {
    if (!nomes.includes(nome)) continue;
    if (/sessao\.usuario\.id/.test(corpo)) ok(`${nome} escreve só no próprio perfil`);
    else erro(`${arquivo} · ${nome} está isenta de papel mas não se amarra a sessao.usuario.id`);
  }
}

console.log(`\n${total} action(s) auditada(s), ${isentas} isenta(s) por declaração.`);
if (falhas === 0) console.log('\x1b[32m>>> AUTORIZAÇÃO OK\x1b[0m');
else { console.log(`\x1b[31m>>> ${falhas} problema(s)\x1b[0m`); process.exit(1); }
