-- O mínimo do schema `auth` do Supabase, para o app rodar contra um Postgres nu.
--
-- Em produção quem provê isto é o GoTrue. Aqui só existem as duas coisas de que
-- o domínio depende: a tabela que o trigger `on_auth_user_created` observa, e a
-- função que TODA policy de RLS chama. Sem `auth.uid()` as policies não
-- compilam, e sem `auth.users` as migrations não aplicam.
--
-- Não é uma reimplementação do Supabase Auth: não há senha, sessão nem token.
-- Quem é o usuário logado vem de `request.jwt.claim.sub`, que o shim define por
-- consulta — exatamente como o PostgREST faz com o JWT de verdade.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
