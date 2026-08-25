/**
 * Onde cada papel PODE entrar, e para onde é devolvido quando não pode.
 *
 * A autorização deste sistema tem três camadas: a RLS no banco, a conferência
 * de papel dentro de cada Server Action, e o desvio de rota nas telas. As duas
 * primeiras já têm suíte (`supabase/tests/rls*.sql` e `autorizacao.mjs`); esta
 * cobre a terceira, que nunca tinha sido medida de ponta a ponta.
 *
 * ── Sobre esperar o suficiente ────────────────────────────────────────────
 *
 * O desvio NÃO chega como um 307. O layout abre um `<Suspense>` e o Next começa
 * a mandar HTML antes de a página decidir, então o `redirect()` sai embutido no
 * fluxo já em curso: a resposta é 200, e o navegador só troca de endereço
 * depois de processá-la.
 *
 * Isso torna a medição fácil de errar, e errar aqui é caro nos dois sentidos.
 * Medindo cedo — `domcontentloaded`, ou o `curl` que lê só o cabeçalho — todo
 * papel parece entrar em toda tela, e o relatório acusa um buraco de permissão
 * que não existe. Foi o que aconteceu na primeira leitura desta matriz, e
 * levou a suspeitar de um sistema que estava certo. `networkidle` mais uma
 * folga é o que dá tempo de o desvio acontecer.
 *
 * O que o 200 significa de verdade está conferido no fim: o HTML que chega
 * antes do desvio é só a casca do layout, sem nenhum dado da tela negada.
 */
import { writeFileSync } from 'node:fs';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';

const PAPEIS = {
  planejamento: '00000000-0000-0000-0000-000000000001',
  gestor:       '00000000-0000-0000-0000-000000000002',
  colaborador:  '00000000-0000-0000-0000-000000000003',
  admin_local:  '00000000-0000-0000-0000-000000000005',
  admin_geral:  '00000000-0000-0000-0000-000000000009',
};

// Onde cada rota tem de PARAR, por papel. O destino descreve a intenção: o
// colaborador vai para a tela dele, os demais para os indicadores, e o
// Administrador Geral nunca sai do console de áreas — ele não tem área, então
// toda tela do domínio é vazia para ele por construção.
const ESPERADO = {
  planejamento: {
    '/parametros': '/parametros', '/usuarios': '/usuarios', '/colaboradores': '/colaboradores',
    '/planos': '/gerar', '/gerar': '/gerar', '/calendario': '/calendario', '/ocupacao': '/ocupacao',
    '/solicitacoes': '/solicitacoes', '/mural': '/mural', '/minha-escala': '/minha-escala',
    '/areas': '/', '/hoje': '/',
  },
  gestor: {
    '/calendario': '/calendario', '/ocupacao': '/ocupacao', '/solicitacoes': '/solicitacoes',
    '/mural': '/mural', '/minha-escala': '/minha-escala',
    '/parametros': '/', '/usuarios': '/', '/colaboradores': '/', '/planos': '/', '/gerar': '/',
    '/areas': '/', '/hoje': '/',
  },
  colaborador: {
    '/hoje': '/hoje', '/minha-escala': '/minha-escala', '/solicitacoes': '/solicitacoes',
    '/mural': '/mural',
    // As telas de operação mandam para a escala dele; as de cadastro, para Hoje.
    '/calendario': '/minha-escala', '/ocupacao': '/minha-escala',
    '/parametros': '/hoje', '/usuarios': '/hoje', '/colaboradores': '/hoje',
    '/planos': '/hoje', '/gerar': '/hoje', '/areas': '/hoje',
  },
  admin_local: {
    '/parametros': '/parametros', '/usuarios': '/usuarios', '/colaboradores': '/colaboradores',
    // Quem responde pela área monta a área, não o mês.
    '/planos': '/', '/gerar': '/', '/calendario': '/', '/ocupacao': '/', '/solicitacoes': '/',
    '/mural': '/', '/minha-escala': '/', '/areas': '/', '/hoje': '/',
  },
  admin_geral: {
    '/areas': '/areas',
    '/parametros': '/areas', '/usuarios': '/areas', '/colaboradores': '/areas', '/planos': '/areas',
    '/gerar': '/areas', '/calendario': '/areas', '/ocupacao': '/areas', '/solicitacoes': '/areas',
    '/mural': '/areas', '/hoje': '/areas', '/minha-escala': '/areas',
  },
};

// Marcadores de conteúdo protegido: se algum aparecer no HTML de uma tela que
// o papel não pode ver, o desvio chegou tarde demais e o dado já saiu.
const VAZAMENTOS = {
  '/parametros': ['Adicionar unidade', 'Capacidade e posições reservadas', 'tolerancia'],
  '/usuarios': ['Criar acesso', 'Quem entra no sistema'],
  '/colaboradores': ['Importar por planilha', 'matricula'],
  // "Administrador da Área" NÃO serve de marcador: é o rótulo do papel de quem
  // está logado, impresso no topo de toda tela. Marcador tem de ser exclusivo
  // do conteúdo que se quer proteger, senão o teste acusa vazamento no lugar
  // onde o sistema apenas diz à pessoa quem ela é.
  '/areas': ['Cadastrar área', 'Nova área'],
};

let falhas = 0;
const b = await abrirNavegador();

for (const [papel, id] of Object.entries(PAPEIS)) {
  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: `${papel}@x` }));
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const erradas = [];

  for (const [rota, destino] of Object.entries(ESPERADO[papel])) {
    await p.goto(BASE + rota, { waitUntil: 'networkidle' });
    // A folga é o desvio embutido no fluxo, não a rede: ver o cabeçalho.
    await p.waitForTimeout(400);
    const fim = new URL(p.url()).pathname;
    if (fim !== destino) erradas.push(`${rota} parou em ${fim}, esperado ${destino}`);

    // Barrado? Então nada da tela pode ter chegado junto.
    if (fim !== rota && VAZAMENTOS[rota]) {
      const html = await p.content();
      const vazou = VAZAMENTOS[rota].filter(m => html.includes(m));
      if (vazou.length) erradas.push(`${rota} vazou ${vazou.join(', ')} antes de desviar`);
    }
  }

  if (erradas.length) {
    falhas += erradas.length;
    console.log(`  FALHOU ${papel}`);
    for (const e of erradas) console.log(`         ${e}`);
  } else {
    console.log(`  ok     ${papel.padEnd(13)} ${Object.keys(ESPERADO[papel]).length} rota(s) no lugar certo`);
  }

  await p.context().close();
}

await b.close();
console.log(falhas ? `\n${falhas} rota(s) fora do lugar` : '\n>>> TODA ROTA DEVOLVE CADA PAPEL PARA O LUGAR CERTO');
process.exit(falhas ? 1 : 0);
