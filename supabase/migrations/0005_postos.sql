-- Escala — postos: uma função exercida dentro de uma unidade, por um período.
--
-- Substitui a sub-unidade da 0004, que estava errada de modelagem. Corpo
-- Clínico não é um lugar concorrente do Morumbi: é o que a pessoa faz enquanto
-- está no Morumbi. Como unidade, ele duplicava a contagem de cadeiras e
-- obrigava a distribuição percentual a incluí-lo como destino.
--
-- Aqui o posto é uma marca na alocação. Quem está no Corpo Clínico ocupa uma
-- posição do Morumbi — a mesma de sempre — e a escala apenas registra que
-- naquele dia ela está no posto. Capacidade não muda.
--
-- A escala do posto é semanal e contígua: "5 dias" significa a semana inteira,
-- de segunda a sexta; "3 dias" significa segunda, terça e quarta. É como o
-- rodízio funciona na prática, e evita alguém indo ao posto em dias soltos.

-- ── Desfaz a 0004 ────────────────────────────────────────────────
drop trigger if exists unidades_hierarquia on unidades;
drop function if exists checa_hierarquia_unidade();
drop index if exists unidades_pai_idx;
alter table unidades drop column if exists pai_id;

-- ── Postos ───────────────────────────────────────────────────────
create table postos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  unidade_id bigint not null references unidades(id) on delete cascade,
  nome text not null,
  -- Quantas pessoas o posto comporta ao mesmo tempo. O padrão 1 é o caso do
  -- Corpo Clínico: um técnico de plantão para os médicos.
  vagas int not null default 1 check (vagas >= 1),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (unidade_id, nome)
);
create index postos_conta_id_idx on postos(conta_id);
create index postos_unidade_idx on postos(unidade_id);

-- ── Atribuição do posto no plano mensal ──────────────────────────
create table plano_posto (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  plano_id bigint not null references planos(id) on delete cascade,
  posto_id bigint not null references postos(id) on delete cascade,
  -- 1 a 5: dias úteis contíguos a partir da segunda-feira da semana escolhida.
  dias int not null check (dias between 1 and 5),
  -- Semana do mês (1 = a que contém o dia 1º). Nulo deixa o motor escolher,
  -- que é o que permite rodiziar o posto entre as pessoas sem trabalho manual.
  semana int check (semana between 1 and 6),
  unique (plano_id, posto_id)
);
create index plano_posto_plano_idx on plano_posto(plano_id);

-- ── Marca na alocação ────────────────────────────────────────────
alter table alocacoes
  add column posto_id bigint references postos(id) on delete set null;
create index alocacoes_posto_idx on alocacoes(posto_id) where posto_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────
alter table postos enable row level security;
alter table plano_posto enable row level security;

create policy postos_select on postos for select
  using (conta_id = conta_id());
create policy postos_write on postos for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy plano_posto_select on plano_posto for select
  using (conta_id = conta_id());
create policy plano_posto_write on plano_posto for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());
