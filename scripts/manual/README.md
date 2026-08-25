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
| `preparar.sh` | Levanta os bancos de teste do zero: migrations, grants e massa |
| `navegador.mjs` | Abre o Chromium; honra `CHROMIUM_EXECUTAVEL` quando o ambiente já tem um |
| `auth-stub.sql` | O mínimo do schema `auth` do Supabase, para rodar contra Postgres nu |
| `supabase-pg.mjs` | Cliente Supabase falso sobre o Postgres local |
| `semear.ts` | Massa de exemplo: duas áreas, cinco papéis, 15 pessoas, novembro de 2026 |
| `fotografar.mjs` | Roteiro de captura, papel por papel |
| `varrer.mjs` | Abre toda tela em todo papel e acusa erro de HTTP, de JS ou de consulta |
| `navegar.mjs` | Descobre os destinos navegando: segue todo link, abre toda gaveta |
| `acoes.mjs` | Executa cada ação de escrita e confere que ela gravou no banco |

## Receita

Requer Postgres 16 local e Playwright (`npm i -D playwright`).

```bash
# 1. Bancos: migrations, papel app_user, grants e massa
scripts/manual/preparar.sh

# 2. Apontar o app para o shim — TEMPORÁRIO, desfazer no fim
#    src/lib/supabase/server.ts  -> export { createClient } from '../../../scripts/manual/supabase-pg.mjs';
#    src/lib/supabase/admin.ts   -> export { createAdminClient } from '../../../scripts/manual/supabase-pg.mjs';
#    src/lib/supabase/proxy.ts   -> updateSession devolve NextResponse.next({ request })
PGDATABASE=manual npm run dev

# 3. Fotografar e desfazer a troca
node scripts/manual/fotografar.mjs
git checkout -- src/lib/supabase/server.ts src/lib/supabase/admin.ts src/lib/supabase/proxy.ts

# 4. PDF
node scripts/manual-pdf.mjs
```

Desfazer arquivo por arquivo, e não `git checkout -- src/lib/supabase/`: a pasta
também contém `types.ts`, que não faz parte da troca. Reverter a pasta inteira
apaga alterações legítimas feitas no meio do caminho — e o erro só aparece no
`tsc`, minutos depois, parecendo outra coisa.

## Suíte de regressão

Os roteiros abaixo rodam contra o mesmo dev server das fotos e existem porque a
tela de solicitações ficou vazia em produção sem ninguém perceber.

```bash
node scripts/manual/rotas.mjs        # 5 papéis × 12 rotas: onde cada um pode entrar
node scripts/manual/varrer.mjs       # 20 telas × 5 papéis, lista fixa
node scripts/manual/navegar.mjs      # segue todo link a partir das raízes de cada papel
node scripts/manual/hostil.mjs       # dado inválido em cada formulário; nada pode entrar
node scripts/manual/implantacao.mjs  # o pedido do Planejamento, de ponta a ponta
node scripts/manual/solicitar.mjs    # o pedido do colaborador, inclusive num banco sem a 0027
node scripts/manual/triagem.mjs      # as saídas da triagem e as decisões a partir de fila e tratativa
node scripts/manual/acoes.mjs        # as ações de escrita, cada uma conferida no banco
```

Os seis juntos são o alvo `navegador` da bateria, que é como se roda todos de
uma vez com o veredito somado:

```bash
./scripts/testar.sh navegador
```

**`acoes.mjs` por último, sempre.** Ele encerra o mês de novembro no fim, e mês
encerrado recusa ajuste, ocorrência e solicitação nova — rodá-lo antes deixa os
demais medindo um cenário fechado e culpando as telas erradas.

Dois hábitos que este conjunto cobrou caro para ensinar:

- **Esperar o suficiente antes de concluir.** O desvio de rota sai embutido no
  fluxo de uma resposta 200, não num 307, e a gravação de uma Server Action
  termina depois de `networkidle`. Medir cedo produz o pior tipo de resultado:
  um relatório vermelho sobre um sistema que está certo. `rotas.mjs` explica o
  caso em detalhe no cabeçalho.
- **Um roteiro de cada vez.** Todos escrevem em `/tmp/foto-usuario.json` para
  trocar de papel. Dois rodando em paralelo trocam o usuário embaixo um do
  outro, e o resultado não é um erro: são duas listas plausíveis e erradas.

Num ambiente que já traz o Chromium instalado — CI, container pronto — o
Playwright costuma querer outra build e morre pedindo `npx playwright install`.
Aponte o binário existente em vez de baixar:

```bash
CHROMIUM_EXECUTAVEL=/opt/pw-browsers/chromium node scripts/manual/navegar.mjs
```

Rode os três em DOIS bancos, um em cada nível de migration — é isso que pega o
descompasso entre o código e o esquema que a instalação realmente tem:

```bash
scripts/manual/preparar.sh    # monta manual, manual_0008 e rlstest
```

`manual_0008` **pula a 0009 e roda todo o resto**. Não é o banco parado na
oitava migration: é a instalação que, por qualquer razão, não aplicou a que
trocou as chaves estrangeiras por compostas, e que continua recebendo as
seguintes. É esse descompasso que existe no mundo real.

`varrer.mjs` confere a URL final, não só o status: um redirecionamento para
`/login` devolve 200, e a primeira versão da varredura passou inteira sem ter
aberto uma única tela do sistema.

`navegar.mjs` também testa o contrário — a lista `PROIBIDAS` diz, para cada
papel, quais rotas ele NÃO deve abrir e onde deve parar. Cuidado ao mexer nela:
um `redirect()` chamado dentro da página (e não no layout) acontece depois que o
Next já despachou o começo do HTML, então o status fica 200 e o desvio vira
navegação do lado do cliente. Ler a URL cedo demais acusa como quebrada uma
trava que funciona.

## `varrer.mjs` e `navegar.mjs` não são a mesma coisa

`varrer.mjs` abre uma **lista fixa** de rotas. É rápido e determinístico, e é o
que se roda para saber se as telas conhecidas continuam de pé.

`navegar.mjs` **descobre** os destinos: parte de uma raiz por papel, colhe os
links da página, abre cada um e repete até a fila esvaziar, acionando também os
controles que só renderizam depois de um clique (abas, `<details>`, a gaveta de
ajuste). Ele encontra a tela que ninguém lembrou de pôr na lista fixa — que é
exatamente a que fica meses sem ser exercitada.

Rotas que não devolvem HTML (o anexo do mural) são conferidas por status e
tamanho, e não por render: o Chromium responde a um PDF baixando o arquivo, e
`page.goto` lança "Download is starting", que não é erro do sistema.

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

- **`rpc()` só aceita função sem argumento**, e roda com o mesmo `role` e
  `auth.uid()` das consultas normais. É o que o console de áreas usa
  (`resumo_areas()`), e a função é `security definer`: chamada como
  superusuário, o `where eh_admin_geral()` de dentro dela passaria para qualquer
  um e a trava sumiria sem aviso.
- **`auth.admin.createUser` grava de verdade em `auth.users`**, para o trigger
  `on_auth_user_created` disparar. Antes era um stub que devolvia o usuário
  logado e não escrevia nada — o que bastava até a cadeia de cadastro (o Geral
  cria o administrador da área, o administrador cria o Planejamento) passar a
  depender do perfil que o trigger cria. Um stub silencioso faria a varredura
  aprovar uma tela que não cadastrou ninguém.
- **`_sql()` do shim é memoizado**: montar tem efeito colateral (cada `$n`
  empilha em `valores`), e o método é chamado duas vezes — na execução e no log
  de erro. Sem cache, a segunda chamada deslocava os índices e a linha era
  gravada com os campos trocados, produzindo erros de RLS e de tipo que
  pareciam do app.
- **Colunas `json`/`jsonb` são lidas do catálogo.** Um `[]` enviado como
  literal de array do Postgres entra na coluna jsonb como objeto vazio, e a
  tela de geração quebrava com "conflitos is not iterable".
- **`semear.ts` avança as sequências.** Os ids explícitos do `overriding system
  value` não adiantam a sequência, e o primeiro cadastro feito pela tela
  colidia com a chave primária.
- **Apelido de coluna no `select`** (`em:criado_em`) é sintaxe do PostgREST, e o
  shim precisou aprendê-la. Sem isso a consulta dos avisos morria e o sino caía
  para os eventos de solicitação — uma lista plausível, e por isso a pior
  espécie de falha: nada na tela dizia que faltava metade.
- **`acoes.mjs` espera o banco mudar, não um tempo fixo.** Devolver o controle
  com a requisição ainda em voo fazia o `como()` seguinte trocar o usuário
  embaixo dela: a gravação saía com o nome errado e parecia bug de permissão.
- **`bytea` volta como `Buffer` pelo node-pg e como texto `\x…` pelo
  PostgREST.** A rota do anexo aceita as duas formas; assumir só uma entrega
  arquivo corrompido em metade dos ambientes, e a tela não denuncia.

## Só para fotos

Este diretório não entra no build e o `supabase-pg.mjs` nunca deve ser
importado de `src/`. Se um dia ele aparecer numa importação de produção, é bug.
