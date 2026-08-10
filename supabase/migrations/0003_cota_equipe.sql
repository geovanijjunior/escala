-- Escala — cota de posições por equipe dentro de uma unidade.
--
-- "Reservadas" na unidade tira assentos do bolo: manutenção, visitante, um
-- lugar que ninguém ocupa. Cota por equipe reparte o que sobrou: dos 10 lugares
-- do Morumbi, 5 são dos técnicos 12x36 e 3 dos analistas.
--
-- A cota é um TETO: no máximo N pessoas daquela equipe naquela unidade no dia.
-- Isso também produz garantia quando as cotas somam a capacidade livre — se os
-- 5 lugares dos técnicos existem e o teto dos analistas é 3, um analista não
-- ocupa lugar de técnico nem quando sobra assento. Quem quer garantia faz as
-- cotas fecharem o total; quem quer só limitar deixa sobrar folga.
--
-- Equipe sem cota cadastrada não tem teto: limita apenas a capacidade da
-- unidade. Assim quem não precisa da regra não precisa cadastrar nada.

create table if not exists cotas_equipe (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  unidade_id bigint not null references unidades(id) on delete cascade,
  equipe_id bigint not null references equipes(id) on delete cascade,
  -- null = vale para todos os dias; 0=dom..6=sáb = só naquele dia da semana.
  dow int check (dow between 0 and 6),
  limite int not null check (limite >= 0),
  criado_em timestamptz not null default now()
);

create index if not exists cotas_equipe_conta_id_idx on cotas_equipe(conta_id);
create index if not exists cotas_equipe_unidade_idx on cotas_equipe(unidade_id);

-- Uma cota geral e uma por dia da semana para cada par (unidade, equipe). O dow
-- específico tem precedência sobre a geral na leitura, igual a capacidades.
create unique index if not exists cotas_equipe_geral_uniq
  on cotas_equipe(unidade_id, equipe_id) where dow is null;
create unique index if not exists cotas_equipe_dow_uniq
  on cotas_equipe(unidade_id, equipe_id, dow) where dow is not null;

alter table cotas_equipe enable row level security;

drop policy if exists cotas_equipe_select on cotas_equipe;
create policy cotas_equipe_select on cotas_equipe for select
  using (conta_id = conta_id());
drop policy if exists cotas_equipe_write on cotas_equipe;
create policy cotas_equipe_write on cotas_equipe for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());
