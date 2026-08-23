-- Motor de slot curupira.v1 — schema inicial.
-- Fichas sociais, sem valor monetário. Nenhuma tabela aqui processa dinheiro real.

create extension if not exists pgcrypto;

-- Um ciclo de commit-reveal por conta: o serverSeed fica oculto (só o hash
-- é publicado) até a rotação, que revela o seed anterior e abre um novo ciclo.
create table seed_cycles (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  server_seed   bytea not null,
  server_hash   text not null,
  client_seed   text not null,
  next_nonce    bigint not null default 0,
  active        boolean not null default true,
  started_at    timestamptz not null default now(),
  revealed_at   timestamptz
);

-- Só um ciclo ativo por conta.
create unique index seed_cycles_conta_ativo on seed_cycles (account_id) where active;

create table rounds (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null,
  seed_cycle_id     uuid not null references seed_cycles (id),
  model_id          text not null,
  bet               bigint not null check (bet > 0),
  nonce             bigint not null,
  idempotency_key   uuid not null,
  state             text not null check (
                      state in ('BET_ACCEPTED', 'RNG_DRAWN', 'BASE_EVALUATED', 'SETTLED')
                    ),
  reel_stops        integer[],
  grid              jsonb,
  base_wins         jsonb,
  respin            jsonb,
  multiplier        integer,
  win               bigint,
  entropy           jsonb,
  balance_after     bigint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

create index rounds_conta_criacao on rounds (account_id, created_at desc);

-- Schema literal da seção 6: `round_id` é NOT NULL mesmo para lançamentos
-- administrativos (GRANT) sem rodada de jogo por trás — nesse caso o
-- chamador gera um UUID sintético só para preservar a unicidade
-- (round_id, type). Sem FK para `rounds` de propósito: é o schema exato
-- do prompt, e a integridade de rodadas de jogo já vem de round.ts, que
-- sempre grava em `rounds` antes de lançar no ledger.
create table ledger_entries (
  id           bigserial primary key,
  account_id   uuid        not null,
  round_id     uuid        not null,
  type         text        not null check (type in ('BET', 'WIN', 'REFUND', 'GRANT')),
  amount       bigint      not null,
  model_id     text        not null,
  created_at   timestamptz not null default now(),
  unique (round_id, type)
);

create index ledger_entries_conta_criacao on ledger_entries (account_id, created_at desc);

-- Snapshot materializado do saldo (= SUM(amount) em ledger_entries), mantido
-- na mesma transação que cada lançamento, para leitura O(1) sem agregar.
create table account_balances (
  account_id uuid primary key,
  balance    bigint not null default 0,
  updated_at timestamptz not null default now()
);
