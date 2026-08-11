/**
 * Gera docs/manual-artefato.html: o manual com as imagens embutidas.
 *
 *   node scripts/manual-artefato.mjs
 *
 * O `docs/manual.html` referencia `imagens/*.png` por caminho relativo, o que
 * é o certo para o repositório e para o PDF. Publicado como página avulsa, um
 * caminho relativo não resolve nada e o manual vira um texto com 40 quadrados
 * quebrados. Aqui cada `src` vira um data URI, e o arquivo passa a andar
 * sozinho.
 *
 * O resultado não é versionado: é derivado, some no `.gitignore` e se refaz em
 * um segundo.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(`${raiz}/docs/manual.html`, 'utf8');

let embutidas = 0;
const saida = html.replace(/src="(imagens\/[^"]+)"/g, (_, caminho) => {
  const bytes = readFileSync(`${raiz}/docs/${caminho}`);
  embutidas++;
  return `src="data:image/png;base64,${bytes.toString('base64')}"`;
});

// Uma imagem que ficou de fora vira quadrado quebrado na página publicada, e
// ninguém repara até alguém abrir o capítulo. Melhor falhar aqui.
const restantes = saida.match(/src="(?!data:)[^"]*"/g);
if (restantes) {
  console.error('sobrou src não embutido:', restantes.join(', '));
  process.exit(1);
}

const destino = `${raiz}/docs/manual-artefato.html`;
writeFileSync(destino, saida);
const mb = (statSync(destino).size / 1048576).toFixed(1);
console.log(`docs/manual-artefato.html gerado — ${embutidas} imagens, ${mb} MB`);
