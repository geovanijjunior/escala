-- Jornada — os feriados nacionais já vêm preenchidos.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- A tela de Feriados nascia vazia e cada área redigitava os mesmos nove
-- feriados todo ano — trabalho repetido cujo erro é silencioso: um 12 de
-- outubro esquecido escala gente num dia em que ninguém trabalha, e isso só
-- aparece no dia.
--
-- O cadastro manual continua existindo, e é o que cobre o que a lei federal não
-- cobre: feriado municipal, aniversário da cidade, ponto facultativo que a
-- empresa decidiu adotar.

-- ══════════════════════════════════════════════════════════════
-- Páscoa: base dos feriados móveis
-- ══════════════════════════════════════════════════════════════
-- Algoritmo de Meeus/Jones/Butcher para o calendário gregoriano. É aritmética
-- pura sobre o ano — não há tabela a manter nem ano a acrescentar depois.
create or replace function pascoa(p_ano int) returns date
language plpgsql immutable
as $$
declare
  a int; b int; c int; d int; e int; f int; g int;
  h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := p_ano % 19;
  b := p_ano / 100;
  c := p_ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- Os feriados nacionais de um ano
-- ══════════════════════════════════════════════════════════════
-- Só o que a lei federal declara feriado. Carnaval e Corpus Christi ficam de
-- fora de propósito: são ponto facultativo, e lançá-los como feriado daria
-- folga automática a todo mundo em 5x2 — decisão da operação, não do sistema.
-- Quem os adota cadastra na tela, que continua aberta.
--
-- Consciência Negra entra por ser feriado nacional desde a Lei 14.759/2023.
create or replace function feriados_nacionais(p_ano int)
returns table (data date, nome text)
language sql immutable
as $$
  select * from (values
    (make_date(p_ano,  1,  1), 'Confraternização Universal'),
    (make_date(p_ano,  4, 21), 'Tiradentes'),
    (make_date(p_ano,  5,  1), 'Dia do Trabalho'),
    (make_date(p_ano,  9,  7), 'Independência do Brasil'),
    (make_date(p_ano, 10, 12), 'Nossa Senhora Aparecida'),
    (make_date(p_ano, 11,  2), 'Finados'),
    (make_date(p_ano, 11, 15), 'Proclamação da República'),
    (make_date(p_ano, 11, 20), 'Consciência Negra'),
    (make_date(p_ano, 12, 25), 'Natal'),
    (pascoa(p_ano) - 2,        'Sexta-feira Santa')
  ) as f(data, nome)
$$;

-- ══════════════════════════════════════════════════════════════
-- Semeadura
-- ══════════════════════════════════════════════════════════════
-- `on conflict do nothing` é o que torna isto seguro de repetir: o feriado que
-- a área renomeou ou ajustou fica como está. A semeadura acrescenta o que
-- falta, nunca reescreve o que alguém decidiu.
create or replace function semear_feriados_nacionais(p_conta_id uuid, p_ano int)
returns int
language plpgsql security definer
set search_path = public
as $$
declare n int;
begin
  insert into feriados (conta_id, data, nome)
  select p_conta_id, f.data, f.nome from feriados_nacionais(p_ano) f
  on conflict (conta_id, data) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function semear_feriados_nacionais(uuid, int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function semear_feriados_nacionais(uuid, int) to authenticated;
    grant execute on function feriados_nacionais(int) to authenticated;
    grant execute on function pascoa(int) to authenticated;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- Área nova já nasce com o ano corrente preenchido
-- ══════════════════════════════════════════════════════════════
create or replace function feriados_da_conta_nova() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform semear_feriados_nacionais(new.id, extract(year from current_date)::int);
  return new;
end;
$$;

drop trigger if exists contas_feriados on contas;
create trigger contas_feriados
  after insert on contas
  for each row execute function feriados_da_conta_nova();

-- E as áreas que já existem recebem o ano corrente agora.
do $$
declare c record; ano int := extract(year from current_date)::int;
begin
  for c in select id from contas loop
    perform semear_feriados_nacionais(c.id, ano);
  end loop;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
