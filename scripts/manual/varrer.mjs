/** Abre toda tela, em todo papel, e reporta erro de consulta e de render. */
import { abrirNavegador } from './navegador.mjs';
import { writeFileSync } from 'node:fs';
const COMP = 'competencia=2026-11-01';
const PAPEIS = {
  admin_geral:  '00000000-0000-0000-0000-000000000009',
  admin_local:  '00000000-0000-0000-0000-000000000005',
  planejamento: '00000000-0000-0000-0000-000000000001',
  gestor:       '00000000-0000-0000-0000-000000000002',
  colaborador:  '00000000-0000-0000-0000-000000000003',
};
const ROTAS = [
  '/areas',
  `/?${COMP}`, '/colaboradores', '/colaboradores?id=2', '/usuarios',
  '/parametros?aba=unidades', '/parametros?aba=equipes', '/parametros?aba=feriados',
  '/parametros?aba=motor', '/parametros?aba=auditoria',
  `/planos?${COMP}`, `/planos?${COMP}&colab=2`, `/gerar?${COMP}`,
  `/calendario?${COMP}`, `/calendario?${COMP}&vista=grade`,
  `/calendario?${COMP}&vista=dia&dia=2026-11-09`,
  `/ocupacao?${COMP}&dia=2026-11-09`, '/solicitacoes', `/minha-escala?${COMP}`,
  '/mural',
];
const BASE = process.env.BASE || 'http://localhost:3000';
const b = await abrirNavegador();
let problemas = 0;
for (const [papel, id] of Object.entries(PAPEIS)) {
  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: `${papel}@x` }));
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  for (const rota of ROTAS) {
    erros.length = 0;
    const r = await p.goto(BASE + rota, { waitUntil: 'networkidle' }).catch(e => ({ status: () => 'ERRO ' + e.message }));
    await p.waitForTimeout(150);
    const vazio = await p.evaluate(() => /Nada por aqui|Nenhum|ainda não foi/i.test(document.body.innerText));
    const st = r.status();
    // Sem conferir a URL final, um redirecionamento para /login devolve 200 e a
    // varredura inteira passa sem ter aberto uma única tela do sistema.
    const foiParaLogin = new URL(p.url()).pathname === '/login';
    if (st !== 200 || erros.length || foiParaLogin) {
      problemas++;
      console.log(`  ${papel.padEnd(13)} ${String(st).padEnd(4)} ${rota} ${foiParaLogin ? '→ CAIU NO LOGIN' : ''} ${erros.join('; ')}`);
    } else if (vazio) console.log(`  ${papel.padEnd(13)} vazio ${rota}`);
  }
  await p.context().close();
}
await b.close();
console.log(problemas ? `\n${problemas} rota(s) com problema` : '\nnenhuma rota com erro de HTTP ou de JS');
