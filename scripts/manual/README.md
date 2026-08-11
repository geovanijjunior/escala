# Como as imagens do manual são feitas

As telas de `docs/manual.html` são capturas do sistema de verdade rodando com
dados de verdade. Nada é montado à mão: uma imagem inventada num manual é pior
do que nenhuma imagem, porque quem lê confia nela.

Como o Supabase precisa de Docker e nem todo ambiente tem, o app é apontado
para um Postgres local através de um cliente falso que traduz as consultas do
Supabase em SQL. Ele implementa exatamente o subconjunto que este app usa e
**quebra alto** em qualquer coisa fora dele — um emulador silencioso produziria
telas sutilmente erradas.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `supabase-pg.mjs` | Cliente Supabase falso sobre o Postgres local |
| `semear.ts` | Massa de exemplo: Hospital São Lucas, 15 pessoas, novembro de 2026 |
| `fotografar.mjs` | Roteiro de captura, papel por papel |

## Receita

Requer Postgres 16 local e Playwright (`npm i -D playwright`).

```bash
# 1. Banco com todas as migrations
createdb manual
psql -d manual -f /caminho/auth-stub.sql          # cria auth.users e auth.uid()
for f in supabase/migrations/*.sql; do psql -d manual -v ON_ERROR_STOP=1 -f "$f"; done

# Papel sem BYPASSRLS, para as policies realmente valerem nas fotos
psql -d manual -c "create role app_user nologin" \
  -c "grant usage on schema public, auth to app_user" \
  -c "grant select, insert, update, delete on all tables in schema public to app_user" \
  -c "grant select on auth.users to app_user" \
  -c "grant usage on all sequences in schema public to app_user"

# 2. Massa
PGDATABASE=manual npx tsx scripts/manual/semear.ts

# 3. Apontar o app para o shim — TEMPORÁRIO, desfazer no fim
#    src/lib/supabase/server.ts  -> export { createClient } from '../../../scripts/manual/supabase-pg.mjs';
#    src/lib/supabase/admin.ts   -> export { createAdminClient } from '../../../scripts/manual/supabase-pg.mjs';
#    src/lib/supabase/proxy.ts   -> updateSession devolve NextResponse.next({ request })
PGDATABASE=manual npm run dev

# 4. Fotografar e desfazer a troca
node scripts/manual/fotografar.mjs
git checkout -- src/lib/supabase/

# 5. PDF
node scripts/manual-pdf.mjs
```

## Detalhes que custaram tempo

- **O shim resolve as chaves estrangeiras pelo catálogo**, não por convenção de
  nome. Adivinhar tirando o `s` do plural produz `colaboradore_id` e
  `solicitacoe_id` em português, que não existem, e a tela vem vazia.
- **`bigint` e `numeric` voltam como string no node-pg**; o PostgREST os
  entrega como número. Sem os type parsers, `unidade_id` vira `"2"`, a
  comparação com a lista de ids falha calada e a tela acusa "unidade que não
  existe mais".
- **`date` vira `Date` e desloca o dia** ao serializar em UTC. O domínio inteiro
  trata data como texto ISO.
- **O idioma dos campos `<input type="date">` segue o `LANG` do processo do
  navegador**, não o `locale` do contexto do Playwright. Sem isso o Chromium
  desenha `mm/dd/yyyy` e `08:00 AM`.
- **O papel da sessão vem de `/tmp/foto-usuario.json`**, relido a cada consulta,
  para o roteiro trocar de pessoa sem derrubar o dev server.
- **Cada consulta roda em transação com `set local role app_user`** e o
  `auth.uid()` da pessoa logada. Sem isso o shim consultaria como superusuário,
  o RLS não valeria nada, e as fotos do papel "colaborador" mostrariam a
  empresa inteira.

## Só para fotos

Este diretório não entra no build e o `supabase-pg.mjs` nunca deve ser
importado de `src/`. Se um dia ele aparecer numa importação de produção, é bug.
