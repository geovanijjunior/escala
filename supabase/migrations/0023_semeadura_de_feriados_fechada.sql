-- Jornada — a semeadura de feriados deixa de aceitar a área como parâmetro.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- O buraco
-- ══════════════════════════════════════════════════════════════
-- A 0022 criou `semear_feriados_nacionais(p_conta_id uuid, p_ano int)` como
-- `security definer` e concedeu execução a `authenticated`. `security definer`
-- roda como o DONO da função — a RLS não se aplica — e a área vinha por
-- PARÂMETRO, sem ninguém conferir se era a de quem chamava.
--
-- Toda função concedida a `authenticated` é um endpoint do PostgREST: qualquer
-- pessoa logada podia mandar um POST em `/rest/v1/rpc/semear_feriados_nacionais`
-- com o uuid de OUTRA área e escrever feriados dentro dela. As duas travas da
-- policy `feriados_write` — `conta_id = conta_id()` e `eh_planejamento()` —
-- ficavam ambas de fora do caminho: um colaborador escrevia, e escrevia na
-- área do vizinho.
--
-- Não é um estrago vistoso: o que entra são os feriados nacionais reais, e o
-- `on conflict do nothing` não sobrescreve nada. Mas feriado é ENTRADA DURA do
-- motor — muda quem trabalha em que dia —, e o isolamento entre áreas é a
-- promessa central deste sistema. Um caminho que o fura não pode ficar de pé
-- porque o dano é pequeno.
--
-- ══════════════════════════════════════════════════════════════
-- O fechamento
-- ══════════════════════════════════════════════════════════════
-- A área deixa de ser dito por quem chama e passa a ser deduzida da sessão,
-- que é o mesmo caminho de toda policy do sistema. Sobram duas funções:
--
--   semear_feriados_nacionais(int)        — a que o app chama. Sem uuid: não há
--                                           o que forjar. Confere o papel.
--   semear_feriados_nacionais(uuid, int)  — interna, do trigger de área nova.
--                                           Revogada de `authenticated`.
--
-- O trigger continua precisando da forma com uuid: ele roda quando a área
-- acabou de nascer, disparado pelo Administrador Geral — que por desenho não
-- tem `conta_id` nenhum. Ali o uuid não vem de fora, vem da linha inserida.

-- ══════════════════════════════════════════════════════════════
-- 0. Dois feriados no mesmo dia viram uma linha só
-- ══════════════════════════════════════════════════════════════
-- Quando a Páscoa cai em 23 de abril, a Sexta-feira Santa cai em 21 — o dia de
-- Tiradentes. Acontece em 2000 e 2079 dentro do intervalo que a função atende.
--
-- A lista devolvia as duas linhas, e `feriados` tem unicidade em
-- `(conta_id, data)`: o `on conflict do nothing` da semeadura guardava UMA
-- delas — qual, dependia da ordem de leitura — e devolvia 9 onde a tela dizia
-- que traria 10. O dia era feriado de qualquer jeito, então nada quebrava na
-- escala; o que se perdia era o nome certo e a contagem honesta.
--
-- Agrupar por data resolve na origem, e o nome composto é o que um calendário
-- imprime nesses anos.
create or replace function feriados_nacionais(p_ano int)
returns table (data date, nome text)
language sql immutable
as $$
  select f.data, string_agg(f.nome, ' e ' order by f.ordem)
    from (values
      (make_date(p_ano,  1,  1), 'Confraternização Universal', 1),
      (make_date(p_ano,  4, 21), 'Tiradentes',                 2),
      (make_date(p_ano,  5,  1), 'Dia do Trabalho',            3),
      (make_date(p_ano,  9,  7), 'Independência do Brasil',    4),
      (make_date(p_ano, 10, 12), 'Nossa Senhora Aparecida',    5),
      (make_date(p_ano, 11,  2), 'Finados',                    6),
      (make_date(p_ano, 11, 15), 'Proclamação da República',   7),
      (make_date(p_ano, 11, 20), 'Consciência Negra',          8),
      (make_date(p_ano, 12, 25), 'Natal',                      9),
      (pascoa(p_ano) - 2,        'Sexta-feira Santa',         10)
    ) as f(data, nome, ordem)
   group by f.data
$$;

-- ── 1. A forma interna some do alcance de quem loga ──
revoke all on function semear_feriados_nacionais(uuid, int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function semear_feriados_nacionais(uuid, int) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function semear_feriados_nacionais(uuid, int) from anon;
  end if;
end $$;

comment on function semear_feriados_nacionais(uuid, int) is
  'INTERNA: só o trigger de área nova. Não conceda a authenticated — recebe a área por parâmetro e roda como definer.';

-- ── 2. A forma que o app chama, amarrada à sessão ──
create or replace function semear_feriados_nacionais(p_ano int)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  alvo uuid;
  n int;
begin
  -- As mesmas duas condições da policy `feriados_write`, agora explícitas
  -- porque `security definer` desliga a policy. `eh_planejamento()` cobre
  -- Planejamento e Administrador da Área, que é quem opera Parâmetros.
  alvo := conta_id();
  if alvo is null then
    raise exception 'sem área: só quem pertence a uma área semeia os feriados dela'
      using errcode = 'insufficient_privilege';
  end if;
  if not eh_planejamento() then
    raise exception 'só o Planejamento ou o Administrador da Área traz os feriados nacionais'
      using errcode = 'insufficient_privilege';
  end if;

  insert into feriados (conta_id, data, nome)
  select alvo, f.data, f.nome from feriados_nacionais(p_ano) f
  on conflict (conta_id, data) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function semear_feriados_nacionais(int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function semear_feriados_nacionais(int) to authenticated;
  end if;
end $$;

comment on function semear_feriados_nacionais(int) is
  'Semeia os feriados nacionais do ano NA ÁREA DE QUEM CHAMA. Exige Planejamento ou Administrador da Área.';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
