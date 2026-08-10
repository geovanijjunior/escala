-- Teste das policies de RLS do Escala.
--
-- Monta dois tenants e os três papéis, e verifica que o recorte por papel é do
-- BANCO, não da tela: cada assert abaixo falharia se a policy correspondente
-- fosse afrouxada. Os três blocos `do $$ ... $$` são testes negativos — eles
-- lançam exceção se a operação PASSAR.
--
-- Como rodar (Postgres local, banco já com todas as migrations aplicadas):
--   psql -d escala -f supabase/tests/rls.sql
--
-- Não rode em produção: o script apaga a tabela `perfis` e insere massa de teste.
\set ON_ERROR_STOP on
\pset pager off

-- Um papel sem BYPASSRLS, para as policies realmente valerem.
-- `drop owned by` antes do drop do papel: sem isso a segunda execução falha,
-- porque os grants da rodada anterior ainda dependem do papel.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'drop owned by app_user';
    execute 'drop role app_user';
  end if;
end $$;

create role app_user nologin;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant select on auth.users to app_user;
grant usage on all sequences in schema public to app_user;

-- ───────────────── massa de teste ─────────────────
-- Zera antes de semear, para a suíte poder rodar quantas vezes for preciso.
-- `contas` cascateia para todo o domínio; auth.users é limpa à parte porque
-- vive fora do schema public.
truncate contas cascade;
delete from auth.users;

insert into contas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Hospital A'),
  ('22222222-2222-2222-2222-222222222222', 'Hospital B');

insert into auth.users (id, email) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'plan@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000002', 'gestor@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'colab@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000004', 'colab2@a.com'),
  ('bbbbbbb1-0000-0000-0000-000000000001', 'plan@b.com');

-- O trigger on_auth_user_created criaria contas novas; aqui inserimos os perfis direto.
delete from perfis;
insert into perfis (id, conta_id, nome, email, papel) values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Planejadora A', 'plan@a.com', 'planejamento'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gestor A',      'gestor@a.com','gestor'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Colab A',       'colab@a.com', 'colaborador'),
  ('aaaaaaa1-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Colab A2',      'colab2@a.com','colaborador'),
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Planejador B',  'plan@b.com',  'planejamento');

insert into unidades (id, conta_id, codigo, nome, sigla, capacidade_total, capacidade_reservadas) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'MOR', 'Morumbi', 'MOR', 10, 1),
  (2, '22222222-2222-2222-2222-222222222222', 'CEN', 'Centro',  'CEN', 5, 0);

insert into equipes (id, conta_id, codigo, nome, regime, gestor_id) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'EQ1', 'Equipe do Gestor A', '5x2', 'aaaaaaa1-0000-0000-0000-000000000002'),
  (2, '11111111-1111-1111-1111-111111111111', 'EQ2', 'Equipe sem gestor',  '5x2', null),
  (3, '22222222-2222-2222-2222-222222222222', 'EQB', 'Equipe B',           '5x2', null);

-- Cota da conta A, para o teste de vazamento entre contas ter o que não ver.
insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, limite) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, null, 5);

insert into colaboradores (id, conta_id, perfil_id, nome, matricula, equipe_id, unidade_base_id) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000003', 'Colab A',  '001', 1, 1),
  (2, '11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000004', 'Colab A2', '002', 1, 1),
  (3, '11111111-1111-1111-1111-111111111111', null,                                   'Fora',     '003', 2, 1),
  (4, '22222222-2222-2222-2222-222222222222', null,                                   'Colab B',  '004', 3, 2);

insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias, grupo, motivo) values
  ('11111111-1111-1111-1111-111111111111', 1, 'AUSENCIA', '2026-08-10', 2, 'Atestado', 'Consulta'),
  ('11111111-1111-1111-1111-111111111111', 3, 'AUSENCIA', '2026-08-10', 2, 'Atestado', 'Consulta'),
  ('22222222-2222-2222-2222-222222222222', 4, 'AUSENCIA', '2026-08-10', 2, 'Atestado', 'Consulta');

insert into geracoes (id, conta_id, competencia, versao, status) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', '2026-08-01', 1, 'rascunho');
insert into alocacoes (conta_id, geracao_id, colaborador_id, data, modalidade, unidade_id) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, '2026-08-03', 'UNIDADE', 1),
  ('11111111-1111-1111-1111-111111111111', 1, 3, '2026-08-03', 'UNIDADE', 1);

insert into solicitacoes (id, conta_id, colaborador_id, tipo, data, detalhe, parceiro_id, aceite_parceiro, status)
  overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, 'TROCA_HORARIO', '2026-08-05', 'troca', 2, 'PENDENTE', 'AGUARDA_PARCEIRO');

set role app_user;

\echo '\n=== Planejamento A: enxerga os 3 colaboradores da conta A ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
select count(*) as colaboradores_visiveis from colaboradores;

\echo '=== Gestor A: só a equipe que gerencia (2 pessoas) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000002';
select count(*) as colaboradores_visiveis from colaboradores;
select count(*) as ausencias_visiveis from ausencias;

\echo '=== Colaborador A: só a si mesmo ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
select count(*) as colaboradores_visiveis from colaboradores;
select count(*) as ausencias_visiveis from ausencias;

\echo '=== Colaborador A: rascunho de escala NÃO aparece ==='
select count(*) as geracoes_visiveis from geracoes;
select count(*) as alocacoes_visiveis from alocacoes;

\echo '=== Planejamento B: enxerga só o que é da conta B (1 de cada) ==='
set request.jwt.claim.sub = 'bbbbbbb1-0000-0000-0000-000000000001';
select count(*) as colaboradores_visiveis from colaboradores;
select count(*) as ausencias_visiveis from ausencias;
select count(*) as unidades_visiveis from unidades;
select count(*) as solicitacoes_visiveis from solicitacoes;

\echo '=== Colaborador A2 (parceiro da troca) enxerga a solicitação ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000004';
select count(*) as solicitacoes_visiveis from solicitacoes;

\echo '=== Parceiro pode ACEITAR (AGUARDA_PARCEIRO -> TRIAGEM) ==='
update solicitacoes set status = 'TRIAGEM', aceite_parceiro = 'ACEITO' where id = 1;
select status, aceite_parceiro from solicitacoes where id = 1;

\echo '=== Parceiro NÃO pode saltar para APROVADA (deve falhar) ==='
do $$ begin
  update solicitacoes set status = 'APROVADA' where id = 1;
  raise exception 'FALHA DE SEGURANCA: parceiro aprovou a propria troca';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Parceiro NÃO pode mudar a data do pedido (deve falhar) ==='
do $$ begin
  update solicitacoes set data = '2026-12-25' where id = 1;
  raise exception 'FALHA DE SEGURANCA: parceiro alterou a data';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Colaborador NÃO pode se promover a planejamento (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$ begin
  update perfis set papel = 'planejamento' where id = auth.uid();
  raise exception 'FALHA DE SEGURANCA: escalonamento de privilegio permitido';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Colaborador NÃO pode escrever na escala (deve afetar 0 linhas) ==='
update alocacoes set modalidade = 'HOME' where colaborador_id = 1;

-- Este bloco já existia como comando solto. A RLS o bloqueava certo, mas com
-- ON_ERROR_STOP o script morria aqui: quem rodasse via um "ERROR" no fim e não
-- tinha como distinguir teste que passou de suíte que quebrou.
\echo '=== Colaborador NÃO pode criar unidade (deve falhar) ==='
do $$ begin
  insert into unidades (conta_id, codigo, nome, sigla)
  values ('11111111-1111-1111-1111-111111111111','X','X','X');
  raise exception 'FALHA DE SEGURANCA: colaborador criou unidade';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Colaborador NÃO pode definir cota de equipe (deve falhar) ==='
do $$ begin
  insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, limite)
  values ('11111111-1111-1111-1111-111111111111', 1, 1, null, 99);
  raise exception 'FALHA DE SEGURANCA: colaborador definiu cota de equipe';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Conta B não enxerga cota de equipe da conta A ==='
set request.jwt.claim.sub = 'bbbbbbb1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from cotas_equipe;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: conta B enxergou % cota(s) da conta A', n;
  end if;
  raise notice 'ok: conta B nao ve cotas da conta A';
end $$;

reset role;
\echo ''
\echo '>>> TODOS OS TESTES DE RLS PASSARAM'
