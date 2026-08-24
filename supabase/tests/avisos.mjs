/**
 * A equipe só é avisada de mudança em escala PUBLICADA.
 *
 *   node supabase/tests/avisos.mjs
 *
 * Rascunho é hipótese: o mês ainda está sendo montado, a escala vai ser
 * regerada, e cada movimento de quem monta não é notícia para ninguém. Avisar
 * ali treina a equipe a ignorar o sino — e um sino ignorado não serve quando a
 * mudança é de verdade.
 *
 * A regra vive espalhada por três pontos de `actions-geracao.ts`, e nenhum
 * deles a declara por inteiro: quem lê um só não vê o desenho. Este teste é
 * onde ela está escrita.
 *
 * É estático de propósito. O caminho completo depende de banco, sessão e
 * navegador; a INVARIANTE é textual e cabe numa leitura do arquivo, que roda em
 * todo commit e falha no instante em que alguém tirar a guarda.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arquivo = join(raiz, 'src', 'app', 'actions-geracao.ts');
const texto = readFileSync(arquivo, 'utf8');

let falhas = 0;
const ok = t => console.log(`  \x1b[32mok\x1b[0m: ${t}`);
const erro = t => { console.log(`  \x1b[31mFALHOU\x1b[0m: ${t}`); falhas++; };

/** Corpo de uma função exportada, da assinatura até a próxima. */
function corpoDe(nome) {
  const marca = new RegExp(`^export async function ${nome}\\s*\\(`, 'm');
  const inicio = texto.search(marca);
  if (inicio < 0) return null;
  const resto = texto.slice(inicio + 1);
  const proxima = resto.search(/^export async function /m);
  return proxima < 0 ? resto : resto.slice(0, proxima);
}

console.log('\n\x1b[1m── Aviso de mudança só depois de publicada\x1b[0m\n');

// ── 1. A fila de avisos só recebe com a escala publicada ──
const reposicionar = corpoDe('reposicionarAlocacao');
if (!reposicionar) {
  erro('reposicionarAlocacao não encontrada — o teste perdeu o alvo');
} else {
  const insere = reposicionar.indexOf("from('alteracoes_pendentes')");
  const guarda = reposicionar.indexOf("geracao.status === 'publicada'");

  if (insere < 0) {
    erro('reposicionarAlocacao não mexe mais na fila de avisos — confira se a regra mudou de lugar');
  } else if (guarda < 0) {
    erro('reposicionarAlocacao enfileira aviso SEM checar se a escala está publicada');
  } else if (guarda > insere) {
    erro('a checagem de publicada vem DEPOIS de enfileirar — a guarda não protege nada');
  } else {
    ok('mexer na escala só enfileira aviso quando ela está publicada');
  }
}

// ── 2. Quem dispara o aviso é o ato de comunicar, e mais ninguém ──
const CHAMA_AVISO = /avisarAlteracaoDaEscala\s*\(/g;
const donos = [];
for (const m of texto.matchAll(CHAMA_AVISO)) {
  const antes = texto.slice(0, m.index);
  const assinaturas = [...antes.matchAll(/^export async function (\w+)\s*\(/gm)];
  donos.push(assinaturas.length ? assinaturas[assinaturas.length - 1][1] : '(fora de função exportada)');
}

if (donos.length === 0) {
  erro('ninguém chama avisarAlteracaoDaEscala — a equipe deixou de ser avisada');
} else {
  const indevidos = donos.filter(d => d !== 'publicarAlteracoes');
  if (indevidos.length) {
    erro(`avisarAlteracaoDaEscala é chamada fora de publicarAlteracoes: ${[...new Set(indevidos)].join(', ')}`);
  } else {
    ok(`só publicarAlteracoes avisa a equipe (${donos.length} chamada(s))`);
  }
}

// ── 3. Publicar a escala não é, por si, um aviso de alteração ──
// São coisas diferentes: "a escala saiu" é a publicação; "seu dia mudou" é o
// que vem depois dela. Misturar as duas faria toda publicação disparar um aviso
// de alteração sobre dias que ninguém tinha visto ainda.
const publicar = corpoDe('mudarStatusEscala');
if (!publicar) {
  erro('mudarStatusEscala não encontrada');
} else if (/avisar[A-Z]\w*\s*\(/.test(publicar)) {
  erro('publicar a escala dispara aviso de alteração — são eventos diferentes');
} else {
  ok('publicar a escala não dispara aviso de alteração');
}

// ── 4. Travar um dia não é mudança de escala ──
// A trava diz "não recalcule este dia". O dia continua o mesmo para quem
// trabalha nele, e avisar sobre isso seria ruído puro.
const travar = corpoDe('alternarTrava');
if (!travar) {
  erro('alternarTrava não encontrada');
} else if (/avisar[A-Z]\w*\s*\(|from\('alteracoes_pendentes'\)/.test(travar)) {
  erro('travar/destravar um dia gera aviso — a alocação não mudou para quem trabalha nela');
} else {
  ok('travar um dia não avisa ninguém');
}

if (falhas === 0) console.log('\n\x1b[32m>>> REGRA DE AVISO OK\x1b[0m');
else { console.log(`\n\x1b[31m>>> ${falhas} problema(s)\x1b[0m`); process.exit(1); }
