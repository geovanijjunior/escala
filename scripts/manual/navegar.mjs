/**
 * Percorre o sistema inteiro clicando em tudo, nos três papéis.
 *
 * `varrer.mjs` abre uma lista fixa de rotas; `acoes.mjs` executa as escritas
 * conhecidas. Fica um vão entre os dois: o link ou a aba que ninguém pensou em
 * listar, e que por isso nunca é aberto por teste nenhum. Foi assim que a aba
 * de auditoria passou meses sem ser exercitada.
 *
 * Aqui a lista de destinos não é escrita à mão — ela é descoberta na própria
 * página. O roteiro parte de uma raiz por papel, colhe os links internos, abre
 * cada um, e repete até não achar destino novo. Em cada página ele também
 * aciona os controles que não navegam sozinhos (abas, `<details>`, botões que
 * abrem gaveta) para que o conteúdo escondido também seja renderizado.
 *
 * O que ele NÃO faz: enviar formulário. Isso é de `acoes.mjs`, que sabe montar
 * dados válidos e conferir o efeito no banco. Aqui um clique em "Salvar" com o
 * formulário vazio só produziria ruído de validação.
 *
 *   node scripts/manual/navegar.mjs
 *   BASE=http://localhost:3100 node scripts/manual/navegar.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const COMP = 'competencia=2026-11-01';
const LIMITE = Number(process.env.LIMITE || 200);

const PAPEIS = {
  planejamento: { id: '00000000-0000-0000-0000-000000000001', raizes: [`/?${COMP}`, `/planos?${COMP}`, `/gerar?${COMP}`, `/calendario?${COMP}`, '/colaboradores', '/usuarios', '/parametros', '/solicitacoes', '/mural'] },
  gestor:       { id: '00000000-0000-0000-0000-000000000002', raizes: [`/?${COMP}`, `/calendario?${COMP}`, `/ocupacao?${COMP}`, '/solicitacoes', '/mural'] },
  colaborador:  { id: '00000000-0000-0000-0000-000000000003', raizes: [`/minha-escala?${COMP}`, '/solicitacoes', '/mural'] },
};

/**
 * Duas URLs que só diferem no dia ou no colaborador exercitam o mesmo código.
 * Sem reduzi-las a uma forma canônica, o calendário sozinho gera trinta
 * destinos e a varredura leva dez minutos para não descobrir nada.
 */
function forma(url) {
  const u = new URL(url, BASE);
  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    // Mudam O QUE a página mostra, não QUAL página é: um dia qualquer do
    // calendário exercita o mesmo código que outro.
    if (['dia', 'colab', 'id', 'competencia', 'q', 'equipe', 'modalidade', 'turno'].includes(k)) {
      q.set(k, v ? '_' : '');
    // Estado de mensagem, não de navegação. Sem descartar, cada redirecionamento
    // com `?ok=1` vira um destino novo e a fila não fecha nunca.
    } else if (['ok', 'erro', 'avisados', 'volta'].includes(k)) {
      continue;
    } else {
      q.set(k, v);
    }
  }
  q.sort();
  return `${u.pathname}?${q}`;
}

const problemas = [];
const relatorio = [];

const navegador = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8' } });

for (const [papel, cfg] of Object.entries(PAPEIS)) {
  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: cfg.id, email: `${papel}@x` }));
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const p = await ctx.newPage();

  const errosJs = [];
  p.on('pageerror', e => errosJs.push(e.message));
  // O `console.error` do servidor não chega aqui, mas o do cliente sim — e é
  // onde um erro de hidratação aparece.
  p.on('console', m => { if (m.type() === 'error') errosJs.push(`console: ${m.text().slice(0, 160)}`); });

  const fila = [...cfg.raizes];
  const vistos = new Set();
  let abertas = 0;

  while (fila.length && abertas < LIMITE) {
    const rota = fila.shift();
    const chave = forma(rota);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    abertas++;

    errosJs.length = 0;

    // Nem toda rota é página. O anexo do mural devolve PDF ou imagem, e o
    // Chromium responde a isso baixando o arquivo, o que faz o `goto` lançar
    // "Download is starting" — que não é erro do sistema. Para essas, o que
    // interessa conferir é o status e o tipo, não o que renderizou.
    let baixou = false;
    const r = await p.goto(BASE + rota, { waitUntil: 'networkidle' })
      .catch(e => {
        baixou = /Download is starting/.test(e.message);
        return { status: () => (baixou ? 0 : `ERRO ${e.message.slice(0, 60)}`) };
      });

    if (baixou) {
      const direto = await p.request.get(BASE + rota);
      if (direto.status() !== 200) {
        problemas.push(`${papel} ${direto.status()} ${rota} (arquivo)`);
      } else {
        const bytes = (await direto.body()).length;
        if (bytes === 0) problemas.push(`${papel} arquivo vazio em ${rota}`);
      }
      continue;
    }

    const status = r.status();
    const url = new URL(p.url());

    if (status !== 200) problemas.push(`${papel} ${status} ${rota}`);
    if (url.pathname === '/login') problemas.push(`${papel} caiu no login: ${rota}`);

    // Aciona o que existe na página mas não aparece sem interação. Cada um
    // desses já escondeu um erro que só surgia quando o painel abria.
    for (const seletor of ['summary', 'button:has-text("Ajustar")', 'button:has-text("Lançar")', 'button:has-text("Escolher arquivos")']) {
      const alvos = await p.locator(seletor).all().catch(() => []);
      for (const alvo of alvos.slice(0, 3)) {
        await alvo.click({ timeout: 1500 }).catch(() => {});
        await p.waitForTimeout(60);
      }
    }
    await p.waitForTimeout(120);

    if (errosJs.length) {
      problemas.push(`${papel} JS em ${rota}: ${[...new Set(errosJs)].join(' | ').slice(0, 220)}`);
    }

    // Faixa de erro renderizada pela própria aplicação.
    const faixa = await p.evaluate(() => {
      const el = [...document.querySelectorAll('[role="status"]')]
        .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
      return el ? el.textContent.trim().slice(0, 120) : null;
    });
    if (faixa) problemas.push(`${papel} faixa de erro em ${rota}: ${faixa}`);

    // Colhe os próximos destinos. Só links internos, e nunca `sair` — a
    // varredura terminaria deslogada na segunda página.
    const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && h.startsWith('/') && !h.startsWith('//')));
    for (const href of links) {
      if (/\/(sair|logout)/.test(href)) continue;
      if (!vistos.has(forma(href))) fila.push(href);
    }
  }

  relatorio.push(`  ${papel.padEnd(13)} ${abertas} página(s) abertas, ${vistos.size} forma(s) distintas`);
  await ctx.close();
}

await navegador.close();

console.log(relatorio.join('\n'));
if (problemas.length) {
  console.log(`\n${problemas.length} problema(s):`);
  for (const x of [...new Set(problemas)]) console.log('  ' + x);
  process.exitCode = 1;
} else {
  console.log('\nnenhum erro de HTTP, de JS ou de render em nenhum papel');
}
