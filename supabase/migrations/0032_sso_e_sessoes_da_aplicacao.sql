-- =====================================================================
-- 0032 — SSO corporativo e sessões geridas pela aplicação
-- =====================================================================
--
-- Prepara o banco para a arquitetura do padrão de infraestrutura: o login
-- passa a vir do SSO corporativo (Keycloak) e a SESSÃO passa a ser da
-- aplicação, não do serviço de autenticação.
--
-- Três mudanças, e as três são aditivas: o sistema atual continua funcionando
-- exatamente como está enquanto o novo backend é construído ao lado. É de
-- propósito — há gente usando, e uma migração que exige virar tudo no mesmo
-- dia não se consegue ensaiar.
--
-- 1. `perfis` deixa de depender de `auth.users`
--
--    Hoje `perfis.id` é chave estrangeira para `auth.users(id)`, do GoTrue.
--    Quem entra pelo Keycloak não tem linha em `auth.users`, e com essa FK de
--    pé não teria como ter perfil — o login funcionaria e a pessoa não
--    existiria para o sistema. A FK sai; a coluna e todos os vínculos ficam.
--
--    Isso NÃO desliga o login atual: o gatilho `on_auth_user_created`
--    continua criando o perfil de quem nasce no GoTrue. O que muda é que o
--    perfil deixa de exigir aquela origem.
--
-- 2. `perfis.sso_sub` — quem é a pessoa do lado do Keycloak
--
--    O `sub` do token, que é o identificador estável do usuário no provedor.
--    Não é o e-mail de propósito: e-mail muda (casamento, correção de
--    grafia), e quando muda a pessoa viraria outra. O e-mail serve para o
--    PRIMEIRO encontro, ligando quem já existe aqui a quem chegou de lá.
--
-- 3. `sessoes` — a sessão que a aplicação gere
--
--    O padrão pede sessões geridas pela própria aplicação. Guardar o token do
--    Keycloak num cookie e chamar isso de sessão não atende: não há como
--    encerrar do lado de cá, e o token viaja no navegador. Aqui o cookie leva
--    um valor opaco, e o que ele encontra é uma linha desta tabela.
-- =====================================================================

-- ── 1. O perfil deixa de exigir origem no GoTrue ─────────────────────
alter table perfis drop constraint if exists perfis_id_fkey;


-- ── 2. A identidade do lado do provedor ──────────────────────────────
alter table perfis add column if not exists sso_sub text;

-- Único, mas só entre quem tem: `null` é "ainda não entrou pelo SSO", e há
-- muitos assim durante a transição. Um índice único comum recusaria o
-- segundo deles.
create unique index if not exists perfis_sso_sub_unico
  on perfis (sso_sub) where sso_sub is not null;


-- ── 3. A sessão da aplicação ─────────────────────────────────────────
create table if not exists sessoes (
  -- O SHA-256 do valor que vai no cookie, nunca o valor. Um dump desta
  -- tabela, ou um olhar de quem tem acesso de leitura ao banco, não entrega
  -- sessão de ninguém — é a mesma razão de não guardar senha em claro.
  id            text primary key,
  perfil_id     uuid not null references perfis (id) on delete cascade,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultimo_uso    timestamptz not null default now(),
  -- Para o encerramento do lado do Keycloak: o `sid` do token diz qual
  -- sessão de lá originou esta, e é o que permite derrubar as duas juntas.
  sso_sid       text not null default '',
  -- Guardado para renovar a sessão sem mandar a pessoa ao Keycloak de novo.
  -- Fica no servidor e nunca chega ao navegador.
  sso_refresh   text,
  ip            text not null default '',
  agente        text not null default '',
  encerrada_em  timestamptz
);

create index if not exists sessoes_perfil_idx on sessoes (perfil_id);
-- A varredura que apaga o que venceu passa por aqui.
create index if not exists sessoes_expira_idx on sessoes (expira_em);

-- A tabela é lida e escrita pelo backend, que conecta com credencial própria
-- e resolve a autorização em código. Ela não é exposta pela API REST do
-- Supabase, e a RLS ligada sem policy nenhuma é o que garante isso: qualquer
-- consulta vinda de `anon` ou `authenticated` volta vazia.
alter table sessoes enable row level security;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
