-- Os feriados nacionais, conferidos ano a ano de 2000 a 2100.
--
--   psql -d rlstest -f supabase/tests/feriados.sql
--
-- Feriado é ENTRADA DURA do motor: muda quem trabalha em que dia. E a Páscoa —
-- de onde sai a Sexta-feira Santa — é calculada, não consultada: um erro no
-- algoritmo não aparece como erro, aparece como uma escala plausível e errada,
-- num ano só, talvez daqui a três anos.
--
-- Por isso a conferência é em dois níveis:
--
--   · uma ÂNCORA de datas conhecidas, para o algoritmo não poder estar
--     inteiramente errado de um jeito consistente;
--   · INVARIANTES em todos os 101 anos, para o que a âncora não alcança —
--     domingo, janela de 22/03 a 25/04, e a Sexta-feira Santa dois dias antes.
--
-- Não escreve nada: só chama as funções puras.
\set ON_ERROR_STOP on
\pset pager off

-- ══════════════════════════════════════════════════════════════
-- 1. Âncora: datas de Páscoa conhecidas
-- ══════════════════════════════════════════════════════════════
\echo '\n=== Páscoa confere com as datas conhecidas ==='
do $$
declare
  esperadas date[] := array[
    '2000-04-23','2001-04-15','2002-03-31','2003-04-20','2004-04-11',
    '2005-03-27','2006-04-16','2007-04-08','2008-03-23','2009-04-12',
    '2010-04-04','2011-04-24','2012-04-08','2013-03-31','2014-04-20',
    '2015-04-05','2016-03-27','2017-04-16','2018-04-01','2019-04-21',
    '2020-04-12','2021-04-04','2022-04-17','2023-04-09','2024-03-31',
    '2025-04-20','2026-04-05','2027-03-28','2028-04-16','2029-04-01',
    '2030-04-21','2031-04-13','2032-03-28','2033-04-17','2034-04-09',
    '2035-03-25','2036-04-13','2037-04-05','2038-04-25','2039-04-10',
    '2040-04-01'
  ]::date[];
  i int;
  obtida date;
  erros int := 0;
begin
  for i in 1 .. array_length(esperadas, 1) loop
    obtida := pascoa(1999 + i);
    if obtida <> esperadas[i] then
      raise warning 'Pascoa de %: calculou %, esperado %', 1999 + i, obtida, esperadas[i];
      erros := erros + 1;
    end if;
  end loop;
  if erros > 0 then raise exception 'FALHA: % ano(s) de Pascoa errados', erros; end if;
  raise notice 'ok: % anos de Pascoa conferem com a referencia', array_length(esperadas, 1);
end $$;

-- ══════════════════════════════════════════════════════════════
-- 2. Invariantes em 101 anos
-- ══════════════════════════════════════════════════════════════
\echo '=== A Páscoa é sempre domingo, entre 22/03 e 25/04, de 2000 a 2100 ==='
do $$
declare a int; d date;
begin
  for a in 2000 .. 2100 loop
    d := pascoa(a);
    -- `extract(dow)`: 0 é domingo.
    if extract(dow from d) <> 0 then
      raise exception 'FALHA: a Pascoa de % (%) caiu num dia da semana %', a, d, extract(dow from d);
    end if;
    -- A janela é uma consequência da definição (primeiro domingo depois da
    -- primeira lua cheia da primavera do hemisfério norte) e não muda nunca.
    if d < make_date(a, 3, 22) or d > make_date(a, 4, 25) then
      raise exception 'FALHA: a Pascoa de % caiu em %, fora da janela 22/03–25/04', a, d;
    end if;
  end loop;
  raise notice 'ok: 101 anos dentro da definicao';
end $$;

\echo '=== Sexta-feira Santa é sempre dois dias antes da Páscoa ==='
do $$
declare a int; sexta date;
begin
  for a in 2000 .. 2100 loop
    -- `like`, e não igualdade: nos anos em que a Sexta-feira Santa cai sobre
    -- Tiradentes o nome vem composto ("Tiradentes e Sexta-feira Santa").
    select data into sexta from feriados_nacionais(a) where nome like '%Sexta-feira Santa%';
    if sexta is null then
      raise exception 'FALHA: % nao trouxe Sexta-feira Santa', a;
    end if;
    if sexta <> pascoa(a) - 2 then
      raise exception 'FALHA: em % a Sexta-feira Santa (%) nao e dois dias antes da Pascoa (%)',
        a, sexta, pascoa(a);
    end if;
    if extract(dow from sexta) <> 5 then
      raise exception 'FALHA: a Sexta-feira Santa de % nao caiu numa sexta', a;
    end if;
  end loop;
  raise notice 'ok: 101 anos com a Sexta-feira Santa no lugar';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 3. A lista em si
-- ══════════════════════════════════════════════════════════════
\echo '=== Dez feriados por ano, todos no ano pedido, uma linha por data ==='
do $$
declare a int; n int; fora int; repetidas int; colisoes int := 0;
begin
  for a in 2000 .. 2100 loop
    select count(*) into n from feriados_nacionais(a);

    -- Nove, e não dez, nos anos em que a Sexta-feira Santa cai em 21 de abril e
    -- se junta a Tiradentes numa linha só. `feriados` tem unicidade em
    -- (conta_id, data): duas linhas ali fariam a semeadura descartar uma em
    -- silêncio, com nome arbitrário e contagem mentirosa. Ver a 0023.
    if n = 9 then colisoes := colisoes + 1;
    elsif n <> 10 then raise exception 'FALHA: % trouxe % feriado(s), esperado 10 (ou 9 com colisao)', a, n;
    end if;

    select count(*) into fora from feriados_nacionais(a) where extract(year from data) <> a;
    if fora > 0 then raise exception 'FALHA: % trouxe % feriado(s) de outro ano', a, fora; end if;

    -- A unicidade por data é o ponto: é ela que a tabela exige.
    select count(*) into repetidas from (
      select data from feriados_nacionais(a) group by data having count(*) > 1
    ) x;
    if repetidas > 0 then raise exception 'FALHA: % tem % data(s) repetida(s)', a, repetidas; end if;
  end loop;
  raise notice 'ok: 101 anos com uma linha por data (% ano(s) com feriados coincidentes)', colisoes;
end $$;

\echo '=== Nos anos de coincidência, o nome carrega os dois feriados ==='
do $$
declare a int; nome_composto text;
begin
  -- 2000 e 2079 são os dois anos entre 2000 e 2100 em que a Páscoa cai em 23 de
  -- abril, jogando a Sexta-feira Santa em cima do Tiradentes.
  foreach a in array array[2000, 2079] loop
    select nome into nome_composto from feriados_nacionais(a) where data = make_date(a, 4, 21);
    if nome_composto is null then
      raise exception 'FALHA: % perdeu o feriado de 21 de abril', a;
    end if;
    if nome_composto not like '%Tiradentes%' or nome_composto not like '%Sexta-feira Santa%' then
      raise exception 'FALHA: em % o 21/04 ficou so com "%"', a, nome_composto;
    end if;
  end loop;
  raise notice 'ok: 2000 e 2079 nomeiam os dois feriados do mesmo dia';
end $$;

\echo '=== Os nove fixos estão nas datas certas, e ninguém a mais ==='
do $$
declare
  fixos text[][] := array[
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Consciência Negra'],
    ['12-25', 'Natal']
  ];
  i int; achado text;
begin
  for i in 1 .. array_length(fixos, 1) loop
    select nome into achado from feriados_nacionais(2027)
     where to_char(data, 'MM-DD') = fixos[i][1];
    if achado is null then
      raise exception 'FALHA: falta o feriado de % em 2027', fixos[i][1];
    end if;
    if achado <> fixos[i][2] then
      raise exception 'FALHA: em % veio "%", esperado "%"', fixos[i][1], achado, fixos[i][2];
    end if;
  end loop;
  raise notice 'ok: os nove fixos conferem, mais a Sexta-feira Santa';
end $$;

\echo '=== Carnaval e Corpus Christi ficam de fora, por serem ponto facultativo ==='
do $$
declare n int; begin
  -- Não é esquecimento: são pontos facultativos federais, e cada operação
  -- decide se para ou não. Trazê-los como feriado tiraria gente da escala em
  -- dias que muita área trabalha. Quem quiser cadastra à mão.
  select count(*) into n from feriados_nacionais(2027)
   where data in (pascoa(2027) - 47, pascoa(2027) - 48, pascoa(2027) + 60);
  if n > 0 then
    raise exception 'FALHA: a lista trouxe % ponto(s) facultativo(s) como feriado', n;
  end if;
  raise notice 'ok: ponto facultativo nao entra sozinho';
end $$;

\echo '=== Anos bissextos e viradas de século não deslocam nada ==='
do $$
declare a int; d date;
begin
  foreach a in array array[2000, 2024, 2028, 2100] loop
    select data into d from feriados_nacionais(a) where nome = 'Natal';
    if d <> make_date(a, 12, 25) then
      raise exception 'FALHA: o Natal de % caiu em %', a, d;
    end if;
    select data into d from feriados_nacionais(a) where nome = 'Tiradentes';
    if d <> make_date(a, 4, 21) then
      raise exception 'FALHA: o Tiradentes de % caiu em %', a, d;
    end if;
  end loop;
  -- 2100 não é bissexto (divisível por 100 e não por 400); 2000 é. Se a data
  -- fixa fosse montada somando dias a partir de janeiro, os dois divergiriam.
  raise notice 'ok: 2000 (bissexto) e 2100 (nao bissexto) com as fixas no lugar';
end $$;

\echo ''
\echo '>>> TODOS OS TESTES DE FERIADOS PASSARAM'
