-- RLS avançado: a superfície que a suíte principal não alcança.
--
--   psql -d rlstest -f supabase/tests/rls-avancado.sql
--
-- `rls.sql` cobre as tabelas do domínio pelo caminho normal — quem lê o quê,
-- por papel e por área. Esta suíte cobre o que fica FORA desse caminho:
--
--   · funções `security definer`, que rodam como o dono e portanto NÃO passam
--     por policy nenhuma. Toda função concedida a `authenticated` é um endpoint
--     do PostgREST, chamável por POST direto, sem passar pela tela;
--   · as colunas que a 0021 acrescentou, onde um vínculo entre áreas caberia;
--   · triggers que escrevem em nome de quem não pediu.
--
-- Todo bloco negativo lança exceção se a operação PASSAR. Não rode em produção:
-- o script insere massa e apaga `contas`.
\set ON_ERROR_STOP on
\pset pager off

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'drop owned by app_user';
  else
    execute 'create role app_user nologin';
  end if;
end $$;

grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant select on auth.users to app_user;
grant usage, select on all sequences in schema public to app_user;

-- Sobre FUNÇÕES a concessão NÃO é em bloco, e é a diferença que faz esta suíte
-- valer alguma coisa.
--
-- `grant execute on all functions to app_user` devolveria em bloco justamente
-- o que as migrations revogam uma a uma — e um teste que concede de volta o que
-- está sob exame passa sempre. Em vez disso `app_user` entra como MEMBRO de
-- `authenticated`, que é o papel que o PostgREST assume para quem está logado:
-- ele passa a poder exatamente o que uma pessoa logada pode, nem mais.
--
-- Isso exige que `authenticated` exista quando as migrations rodaram, senão os
-- blocos de `grant` delas foram pulados e ninguém recebeu nada. Quem garante é
-- `scripts/manual/preparar.sh`.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception
      'o papel `authenticated` nao existe: os grants das migrations foram pulados e esta suite nao teria o que verificar. Recrie o banco com scripts/manual/preparar.sh';
  end if;
end $$;

grant authenticated to app_user;

truncate contas cascade;
delete from auth.users;

insert into contas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Área A'),
  ('22222222-2222-2222-2222-222222222222', 'Área B');

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (id, email) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'plan.a@x.com'),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'colab.a@x.com'),
  ('aaaaaaa1-0000-0000-0000-000000000005', 'gestor.a@x.com'),
  ('bbbbbbb1-0000-0000-0000-000000000001', 'plan.b@x.com'),
  ('ccccccc1-0000-0000-0000-000000000001', 'geral@x.com');

insert into perfis (id, conta_id, nome, email, papel) values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Plan A',   'plan.a@x.com',   'planejamento'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Colab A',  'colab.a@x.com',  'colaborador'),
  ('aaaaaaa1-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Gestor A', 'gestor.a@x.com', 'gestor'),
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Plan B',   'plan.b@x.com',   'planejamento'),
  ('ccccccc1-0000-0000-0000-000000000001', null,                                   'Geral',    'geral@x.com',    'admin_geral');

insert into equipes (id, conta_id, codigo, nome, regime, turno) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'EQA', 'Equipe A', '5x2', 'D'),
  (2, '22222222-2222-2222-2222-222222222222', 'EQB', 'Equipe B', '5x2', 'D');

insert into unidades (id, conta_id, codigo, nome, sigla) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'UA', 'Unidade A', 'UA'),
  (2, '22222222-2222-2222-2222-222222222222', 'UB', 'Unidade B', 'UB');

insert into postos (id, conta_id, unidade_id, nome, equipe_id) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, 'Posto A', 1);

insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, minimo) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, null, 3);

-- Os ids acima entraram por `overriding system value`, o que NÃO move a
-- sequência da identity. O primeiro insert que a deixe gerar sozinha pediria o
-- id 1 e bateria na chave primária — um erro que fala de "duplicate key" e não
-- da causa. Os testes adiante criam equipe e posto sem dizer o id.
select setval(pg_get_serial_sequence('equipes',  'id'), 100);
select setval(pg_get_serial_sequence('unidades', 'id'), 100);
select setval(pg_get_serial_sequence('postos',   'id'), 100);

-- ══════════════════════════════════════════════════════════════
-- 1. A semeadura de feriados não escreve na área do vizinho
-- ══════════════════════════════════════════════════════════════
-- A 0022 expunha `semear_feriados_nacionais(uuid, int)` a `authenticated`. Como
-- é `security definer`, a área vinha por parâmetro e ninguém conferia de quem
-- ela era: qualquer pessoa logada escrevia feriados em qualquer área. A 0023
-- tirou o uuid da mão de quem chama. Estes quatro blocos são a prova.

\echo '\n=== Quem loga não recebe execute na forma que aceita a área por parâmetro ==='
do $$ begin
  if has_function_privilege('authenticated', 'semear_feriados_nacionais(uuid, int)', 'execute') then
    raise exception 'FALHA DE SEGURANCA: `authenticated` pode executar a forma com uuid — qualquer pessoa logada escreve na area que quiser';
  end if;
  if has_function_privilege('public', 'semear_feriados_nacionais(uuid, int)', 'execute') then
    raise exception 'FALHA DE SEGURANCA: `public` pode executar a forma com uuid';
  end if;
  if not has_function_privilege('authenticated', 'semear_feriados_nacionais(int)', 'execute') then
    raise exception 'FALHA: `authenticated` nao pode executar a forma sem uuid — o botao de trazer feriados nao funcionaria';
  end if;
  raise notice 'ok: so a forma sem uuid esta ao alcance de quem loga';
end $$;

set role app_user;

\echo '=== Colaborador NÃO alcança a forma interna, com uuid (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$ begin
  perform semear_feriados_nacionais('22222222-2222-2222-2222-222222222222'::uuid, 2030);
  raise exception 'FALHA DE SEGURANCA: a forma com uuid continua ao alcance de quem loga';
exception
  when insufficient_privilege or undefined_function then
    raise notice 'ok: a forma com uuid nao e chamavel por authenticated';
end $$;

\echo '=== Planejamento de A NÃO semeia na área B, nem pela forma interna (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$ begin
  perform semear_feriados_nacionais('22222222-2222-2222-2222-222222222222'::uuid, 2030);
  raise exception 'FALHA DE SEGURANCA: Planejamento de A escreveu feriados na area B';
exception
  when insufficient_privilege or undefined_function then
    raise notice 'ok: nem o Planejamento alcanca a forma com uuid';
end $$;

\echo '=== Colaborador NÃO semeia nem na própria área: falta o papel (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$ begin
  perform semear_feriados_nacionais(2030);
  raise exception 'FALHA DE SEGURANCA: colaborador semeou feriados';
exception when insufficient_privilege then
  raise notice 'ok: a funcao exige Planejamento ou Administrador da Area';
end $$;

\echo '=== Gestor também não (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000005';
do $$ begin
  perform semear_feriados_nacionais(2030);
  raise exception 'FALHA DE SEGURANCA: gestor semeou feriados';
exception when insufficient_privilege then
  raise notice 'ok: gestor nao mexe em parametros da area';
end $$;

\echo '=== Planejamento semeia, e só dentro da própria área ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$
declare n int; na int; nb int;
begin
  select semear_feriados_nacionais(2030) into n;
  if n <> 10 then raise exception 'FALHA: semeou % feriados em 2030, esperado 10', n; end if;

  -- Repetir não duplica: é o que torna o botão seguro de apertar duas vezes.
  select semear_feriados_nacionais(2030) into n;
  if n <> 0 then raise exception 'FALHA: repetir a semeadura criou % linha(s)', n; end if;

  reset role;
  select count(*) into na from feriados
   where conta_id = '11111111-1111-1111-1111-111111111111' and extract(year from data) = 2030;
  select count(*) into nb from feriados
   where conta_id = '22222222-2222-2222-2222-222222222222' and extract(year from data) = 2030;
  set role app_user;

  if na <> 10 then raise exception 'FALHA: a area A ficou com % feriados em 2030', na; end if;
  if nb <> 0  then raise exception 'FALHA DE SEGURANCA: a area B recebeu % feriado(s) de 2030', nb; end if;
  raise notice 'ok: semeou 10 na propria area, 0 na outra, e repetir nao duplica';
end $$;

\echo '=== O Administrador Geral não tem área, e por isso não semeia (deve falhar) ==='
set request.jwt.claim.sub = 'ccccccc1-0000-0000-0000-000000000001';
do $$ begin
  perform semear_feriados_nacionais(2031);
  raise exception 'FALHA DE SEGURANCA: o Geral semeou feriados sem pertencer a area nenhuma';
exception when insufficient_privilege then
  raise notice 'ok: sem conta_id nao ha onde escrever';
end $$;

\echo '=== O feriado ajustado à mão sobrevive à semeadura ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$
declare nome_final text;
begin
  insert into feriados (conta_id, data, nome)
    values ('11111111-1111-1111-1111-111111111111', '2031-01-01', 'Ano Novo — plantão reduzido');
  perform semear_feriados_nacionais(2031);
  select nome into nome_final from feriados
   where conta_id = '11111111-1111-1111-1111-111111111111' and data = '2031-01-01';
  if nome_final <> 'Ano Novo — plantão reduzido' then
    raise exception 'FALHA: a semeadura reescreveu o feriado ajustado a mao (virou %)', nome_final;
  end if;
  raise notice 'ok: acrescenta o que falta e nao reescreve o que alguem decidiu';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 2. Feriado é parâmetro da área, não leitura pública
-- ══════════════════════════════════════════════════════════════
\echo '\n=== Cada área lê só os próprios feriados ==='
do $$
declare n int; begin
  select count(*) into n from feriados where conta_id = '22222222-2222-2222-2222-222222222222';
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: a area A leu % feriado(s) da area B', n; end if;
  raise notice 'ok: feriado nao atravessa a fronteira da area';
end $$;

\echo '=== Colaborador lê os feriados da área (precisa, para entender a escala) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$
declare n int; begin
  select count(*) into n from feriados;
  if n = 0 then raise exception 'FALHA: colaborador nao enxerga feriado nenhum'; end if;
  raise notice 'ok: le os feriados da propria area';
end $$;

\echo '=== Colaborador NÃO cadastra feriado (deve falhar) ==='
do $$ begin
  insert into feriados (conta_id, data, nome)
    values ('11111111-1111-1111-1111-111111111111', '2033-05-05', 'Feriado inventado');
  raise exception 'FALHA DE SEGURANCA: colaborador cadastrou feriado';
exception when insufficient_privilege then
  raise notice 'ok: escrita de feriado e do Planejamento';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 3. A equipe do posto (0021) respeita a fronteira da área
-- ══════════════════════════════════════════════════════════════
\echo '\n=== Posto da área A NÃO aponta para equipe da área B (deve falhar) ==='
reset role;
do $$ begin
  insert into postos (conta_id, unidade_id, nome, equipe_id)
    values ('11111111-1111-1111-1111-111111111111', 1, 'Posto forjado', 2);
  raise exception 'FALHA DE SEGURANCA: posto da area A ficou com equipe da area B';
exception when foreign_key_violation then
  raise notice 'ok: recusado pela chave composta (id, conta_id)';
end $$;

\echo '=== Apagar a equipe solta o posto e preserva a área ==='
do $$
declare eq bigint; ct uuid;
begin
  insert into equipes (conta_id, codigo, nome, regime, turno)
    values ('11111111-1111-1111-1111-111111111111', 'EQX', 'Equipe efemera', '5x2', 'D')
    returning id into eq;
  insert into postos (conta_id, unidade_id, nome, equipe_id)
    values ('11111111-1111-1111-1111-111111111111', 1, 'Posto da efemera', eq);

  -- Sem a lista de colunas no `on delete set null`, isto falharia tentando
  -- anular `conta_id`, que e `not null`. E o erro nao falaria de equipe nenhuma.
  delete from equipes where id = eq;

  select conta_id into ct from postos where nome = 'Posto da efemera';
  if ct is null then raise exception 'FALHA: apagar a equipe anulou a area do posto'; end if;
  if (select equipe_id from postos where nome = 'Posto da efemera') is not null then
    raise exception 'FALHA: o posto ficou apontando para equipe apagada';
  end if;
  raise notice 'ok: o posto sobrevive a equipe, aberto a qualquer uma';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 4. A cota mínima (0021) é dado de área, com dono
-- ══════════════════════════════════════════════════════════════
\echo '\n=== Planejamento de B não enxerga a cota de A ==='
set role app_user;
set request.jwt.claim.sub = 'bbbbbbb1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from cotas_equipe;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: a area B leu % cota(s) da area A', n; end if;
  raise notice 'ok: cota nao atravessa a fronteira da area';
end $$;

\echo '=== Planejamento de B não escreve cota sobre unidade de A (deve falhar) ==='
do $$ begin
  insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, minimo)
    values ('22222222-2222-2222-2222-222222222222', 1, 2, null, 9);
  raise exception 'FALHA DE SEGURANCA: a area B criou cota sobre a unidade 1, que e da area A';
exception when foreign_key_violation or insufficient_privilege then
  raise notice 'ok: recusado antes de virar linha';
end $$;

\echo '=== Colaborador não altera a cota da própria área (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$ begin
  update cotas_equipe set minimo = 99 where conta_id = '11111111-1111-1111-1111-111111111111';
  if found then raise exception 'FALHA DE SEGURANCA: colaborador mudou a cota minima'; end if;
  raise notice 'ok: o update nao alcancou linha nenhuma';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 5. As demais funções `security definer` expostas
-- ══════════════════════════════════════════════════════════════
-- Um inventário que falha quando alguém acrescenta uma função definer nova sem
-- pensar em quem pode chamá-la. A lista embaixo é a das que já foram
-- examinadas; a que não estiver nela precisa ser examinada antes de entrar.
\echo '\n=== Nenhuma função `security definer` nova ficou sem exame ==='
reset role;
do $$
declare
  -- As onze que sustentam a RLS (`conta_id`, `papel`, `eh_*`, `minha*`,
  -- `pode_ver_colaborador`) leem o perfil de quem chama e devolvem BOOLEANO ou
  -- o dado da própria sessão: rodar como dono é o que as faz enxergar `perfis`
  -- sem cair na recursão de uma policy que consultasse a si mesma. Nenhuma
  -- aceita "de quem" por parâmetro, que é a diferença entre elas e o buraco que
  -- a 0023 fechou.
  --
  -- As três que ESCREVEM estão examinadas nos blocos acima e em `rls.sql`:
  -- `handle_novo_usuario` e `feriados_da_conta_nova` são triggers (não há como
  -- chamá-las por fora), `resumo_areas` é leitura com `where eh_admin_geral()`
  -- dentro, e `semear_feriados_nacionais` é o assunto da seção 1.
  conhecidas text[] := array[
    'conta_id', 'papel', 'eh_planejamento', 'eh_admin_geral', 'eh_admin_local',
    'minha_equipe', 'minhas_equipes_geridas', 'pode_ver_colaborador',
    'handle_novo_usuario', 'resumo_areas', 'semear_feriados_nacionais',
    'feriados_da_conta_nova'
  ];
  nova text;
begin
  for nova in
    select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and not (p.proname = any (conhecidas))
     group by p.proname
  loop
    raise exception 'FALHA: funcao `security definer` fora do inventario: %()  — confira quem pode chama-la e acrescente a lista', nova;
  end loop;
  raise notice 'ok: toda funcao definer do schema esta no inventario';
end $$;

\echo ''
\echo '>>> TODOS OS TESTES DE RLS AVANÇADO PASSARAM'
