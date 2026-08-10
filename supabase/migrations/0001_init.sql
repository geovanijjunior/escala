-- Escala — base multi-tenant e autenticação.
--
-- Cada organização é uma "conta". Usuários ("perfis") pertencem a uma conta e
-- têm um papel: planejamento, gestor ou colaborador. O isolamento entre contas
-- é garantido por Row Level Security usando conta_id(), não por filtro de tela.

create extension if not exists "pgcrypto";

-- ========================= CONTAS (tenants) =========================
create table if not exists contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

-- ========================= PERFIS (usuários) =========================
-- id = auth.users.id (1:1 com o usuário do Supabase Auth).
--
-- `papel` é a única dimensão de permissão do sistema:
--   planejamento — configura, gera, publica e faz a triagem das solicitações
--   gestor       — enxerga e aprova apenas a própria equipe
--   colaborador  — enxerga apenas a si mesmo e abre solicitações
create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  conta_id uuid not null references contas(id) on delete cascade,
  nome text not null,
  email text not null,
  papel text not null default 'colaborador'
    check (papel in ('planejamento', 'gestor', 'colaborador')),
  precisa_trocar_senha boolean not null default false,
  bloqueado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists perfis_conta_id_idx on perfis(conta_id);

-- Helpers usados por praticamente toda policy. Security definer para não
-- recursar na RLS da própria tabela.
create or replace function conta_id() returns uuid
language sql stable security definer
set search_path = public
as $$
  select conta_id from perfis where id = auth.uid()
$$;

create or replace function papel() returns text
language sql stable security definer
set search_path = public
as $$
  select papel from perfis where id = auth.uid()
$$;

create or replace function eh_planejamento() returns boolean
language sql stable security definer
set search_path = public
as $$
  select papel() = 'planejamento'
$$;

-- ========================= RLS =========================
alter table contas enable row level security;
alter table perfis enable row level security;

drop policy if exists contas_select on contas;
create policy contas_select on contas for select using (id = conta_id());
drop policy if exists contas_update on contas;
create policy contas_update on contas for update
  using (id = conta_id() and eh_planejamento())
  with check (id = conta_id() and eh_planejamento());

drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select using (conta_id = conta_id());

-- Self-update com as colunas sensíveis congeladas: sem isso, um colaborador
-- se promoveria a planejamento batendo direto na API REST, fora da tela.
drop policy if exists perfis_update_self on perfis;
create policy perfis_update_self on perfis for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel = (select p.papel from perfis p where p.id = auth.uid())
    and conta_id = (select p.conta_id from perfis p where p.id = auth.uid())
  );

drop policy if exists perfis_update_planejamento on perfis;
create policy perfis_update_planejamento on perfis for update
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

drop policy if exists perfis_insert_planejamento on perfis;
create policy perfis_insert_planejamento on perfis for insert
  with check (conta_id = conta_id() and eh_planejamento());

-- ========================= TRIGGER DE SIGNUP =========================
-- Sem conta_id nos metadados, o cadastro cria uma conta nova e o usuário entra
-- como planejamento (é quem está montando a operação). Com conta_id, é um
-- convite: entra na conta existente com o papel indicado.
create or replace function handle_novo_usuario() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_conta_existente uuid;
begin
  v_conta_existente := (new.raw_user_meta_data->>'conta_id')::uuid;

  if v_conta_existente is not null then
    insert into perfis (id, conta_id, nome, email, papel, precisa_trocar_senha)
    values (
      new.id, v_conta_existente,
      coalesce(new.raw_user_meta_data->>'nome', new.email),
      new.email,
      coalesce(new.raw_user_meta_data->>'papel', 'colaborador'),
      coalesce((new.raw_user_meta_data->>'precisa_trocar_senha')::boolean, false)
    );
  else
    insert into contas (nome)
    values (coalesce(new.raw_user_meta_data->>'organizacao', new.raw_user_meta_data->>'nome', new.email))
    returning id into v_conta_id;

    insert into perfis (id, conta_id, nome, email, papel)
    values (new.id, v_conta_id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email, 'planejamento');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_novo_usuario();
