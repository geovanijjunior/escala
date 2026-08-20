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
--
-- O papel é reaproveitado em vez de recriado. Duas armadilhas justificam isso:
-- na segunda execução os grants da rodada anterior impedem o `drop role`, e
-- papéis são objetos do CLUSTER, não do banco — se o mesmo papel tiver grants
-- em outro banco (um segundo ambiente de teste na mesma instância), o drop
-- falha com "38 objects in database X" e a suíte inteira aborta. `drop owned
-- by` limpa só o que é deste banco, que é exatamente o escopo desejado.
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
grant usage on all sequences in schema public to app_user;
-- `resumo_areas()` é revogada de `public` pela 0015. Sem este grant a suíte
-- veria "permission denied" onde deveria ver "0 linhas", que são coisas bem
-- diferentes: uma é o grant faltando, a outra é a trava funcionando.
grant execute on all functions in schema public to app_user;

-- ───────────────── massa de teste ─────────────────
-- Zera antes de semear, para a suíte poder rodar quantas vezes for preciso.
-- `contas` cascateia para todo o domínio; auth.users é limpa à parte porque
-- vive fora do schema public.
truncate contas cascade;
delete from auth.users;

insert into contas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Hospital A'),
  ('22222222-2222-2222-2222-222222222222', 'Hospital B');

-- O trigger `on_auth_user_created` cria uma CONTA para todo usuário que chega
-- sem `conta_id` nos metadados. Aqui os perfis são inseridos à mão, então o
-- trigger só produziria contas órfãs — invisíveis para as contagens antigas,
-- mas contadas pelas do Administrador Geral, que é quem enxerga `contas`.
-- Antes disso o teste do console de áreas via sete áreas onde há duas.
alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (id, email) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'plan@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000002', 'gestor@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'colab@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000004', 'colab2@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000005', 'admin@a.com'),
  ('bbbbbbb1-0000-0000-0000-000000000001', 'plan@b.com'),
  ('bbbbbbb1-0000-0000-0000-000000000002', 'admin@b.com'),
  ('ccccccc1-0000-0000-0000-000000000001', 'geral@jornada.com'),
  -- Logins sem perfil, para os testes de cadastro mais abaixo. `perfis.id`
  -- referencia `auth.users`, e criar perfil é o que aqueles testes fazem — sem
  -- o login pronto, o que falharia seria a chave estrangeira, e um teste
  -- negativo passaria pelo motivo errado.
  ('aaaaaaa1-0000-0000-0000-000000000007', 'plan2@a.com'),
  ('aaaaaaa1-0000-0000-0000-000000000008', 'admin2@a.com'),
  ('ccccccc1-0000-0000-0000-000000000008', 'plan@c.com'),
  ('ccccccc1-0000-0000-0000-000000000009', 'admin@c.com');

alter table auth.users enable trigger on_auth_user_created;

delete from perfis;
insert into perfis (id, conta_id, nome, email, papel) values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Planejadora A', 'plan@a.com', 'planejamento'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gestor A',      'gestor@a.com','gestor'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Colab A',       'colab@a.com', 'colaborador'),
  ('aaaaaaa1-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Colab A2',      'colab2@a.com','colaborador'),
  ('aaaaaaa1-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Admin A',       'admin@a.com', 'admin_local'),
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Planejador B',  'plan@b.com',  'planejamento'),
  ('bbbbbbb1-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Admin B',       'admin@b.com', 'admin_local'),
  -- Sem conta: é isso que mantém o Administrador Geral fora dos dados.
  ('ccccccc1-0000-0000-0000-000000000001', null,                                   'Admin Geral',   'geral@jornada.com', 'admin_geral');

insert into unidades (id, conta_id, codigo, nome, sigla, capacidade_total, capacidade_reservadas) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'MOR', 'Morumbi', 'MOR', 10, 1),
  (2, '22222222-2222-2222-2222-222222222222', 'CEN', 'Centro',  'CEN', 5, 0);

insert into equipes (id, conta_id, codigo, nome, regime, gestor_id) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'EQ1', 'Equipe do Gestor A', '5x2', 'aaaaaaa1-0000-0000-0000-000000000002'),
  (2, '11111111-1111-1111-1111-111111111111', 'EQ2', 'Equipe sem gestor',  '5x2', null),
  (3, '22222222-2222-2222-2222-222222222222', 'EQB', 'Equipe B',           '5x2', null);

-- Cota da conta A, para o teste de vazamento entre contas ter o que não ver.
insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, minimo) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, null, 5);

insert into colaboradores (id, conta_id, perfil_id, nome, matricula, equipe_id, unidade_base_id) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000003', 'Colab A',  '001', 1, 1),
  (2, '11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000004', 'Colab A2', '002', 1, 1),
  (3, '11111111-1111-1111-1111-111111111111', null,                                   'Fora',     '003', 2, 1),
  (4, '22222222-2222-2222-2222-222222222222', null,                                   'Colab B',  '004', 3, 2);

insert into postos (id, conta_id, unidade_id, nome) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, 'Corpo Clínico');

-- Plano do Colab A2 cobrindo o posto. O Colab A (outra pessoa, mesmo tenant)
-- não pode enxergar isso: é dado de plano, com recorte por papel.
insert into planos (id, conta_id, colaborador_id, competencia) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 2, '2026-08-01');
insert into plano_posto (conta_id, plano_id, posto_id, dias, semana) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, 5, 2);

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

-- Mural: os três públicos que existem, para o recorte poder errar de três
-- formas diferentes e ser pego em cada uma.
insert into comunicados (id, conta_id, titulo, corpo, publico, equipe_id, autor_id, autor_nome)
  overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'Para todos', '', 'colaboradores', null,
     'aaaaaaa1-0000-0000-0000-000000000001', 'Planejadora A'),
  (2, '11111111-1111-1111-1111-111111111111', 'Da equipe 1', '', 'colaboradores', 1,
     'aaaaaaa1-0000-0000-0000-000000000002', 'Gestor A'),
  (3, '11111111-1111-1111-1111-111111111111', 'Só gestores', '', 'gestores', null,
     'aaaaaaa1-0000-0000-0000-000000000001', 'Planejadora A'),
  (4, '11111111-1111-1111-1111-111111111111', 'Da equipe 2', '', 'colaboradores', 2,
     'aaaaaaa1-0000-0000-0000-000000000001', 'Planejadora A');

insert into comunicado_anexos (conta_id, comunicado_id, nome, tipo, tamanho, conteudo) values
  ('11111111-1111-1111-1111-111111111111', 3, 'so-gestores.pdf', 'application/pdf', 4, '\\x25504446');

-- Aviso é o único item do domínio com destinatário nomeado: quem não é o
-- destinatário não pode lê-lo, nem sendo Planejamento.
insert into avisos (conta_id, perfil_id, titulo, detalhe, rota, por_nome) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000003',
   'Escala alterada', 'para o Colab A', '/calendario', 'Planejadora A'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaa1-0000-0000-0000-000000000004',
   'Escala alterada', 'para o Colab A2', '/calendario', 'Planejadora A');

insert into alteracoes_pendentes (conta_id, geracao_id, colaborador_id, data, de, para, por_nome) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, '2026-08-03', 'Morumbi', 'Home Office', 'Planejadora A');

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
  insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, minimo)
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

\echo '=== Colaborador NÃO enxerga o posto do plano de outra pessoa ==='
do $$
declare n int; begin
  select count(*) into n from plano_posto;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: colaborador viu % linha(s) de plano_posto alheias', n;
  end if;
  raise notice 'ok: plano_posto respeita o recorte por papel';
end $$;

\echo '=== Mas o dono do plano enxerga o próprio posto ==='
do $$
declare n int; begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaa1-0000-0000-0000-000000000004', true);
  select count(*) into n from plano_posto;
  if n <> 1 then
    raise exception 'FALHOU: dono do plano deveria ver 1 posto, viu %', n;
  end if;
  raise notice 'ok: dono do plano enxerga o próprio posto';
  perform set_config('request.jwt.claim.sub', 'aaaaaaa1-0000-0000-0000-000000000003', true);
end $$;

\echo '=== Colaborador NÃO pode criar posto (deve falhar) ==='
do $$ begin
  insert into postos (conta_id, unidade_id, nome) values
    ('11111111-1111-1111-1111-111111111111', 1, 'Invadido');
  raise exception 'FALHA DE SEGURANCA: colaborador criou posto';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

-- ───────────────── mural e avisos ─────────────────

\echo '=== Colaborador A: vê o mural de todos e o da equipe dele, não o dos gestores ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$
declare n int; begin
  select count(*) into n from comunicados;
  -- 'Para todos' e 'Da equipe 1'. Nunca 'Só gestores' nem 'Da equipe 2'.
  if n <> 2 then
    raise exception 'FALHA DE SEGURANCA: colaborador viu % comunicado(s), esperado 2', n;
  end if;
  if exists (select 1 from comunicados where publico = 'gestores') then
    raise exception 'FALHA DE SEGURANCA: colaborador leu o mural dos gestores';
  end if;
  if exists (select 1 from comunicados where equipe_id = 2) then
    raise exception 'FALHA DE SEGURANCA: colaborador leu o mural de outra equipe';
  end if;
  raise notice 'ok: mural recortado para o colaborador';
end $$;

\echo '=== O anexo herda o recorte do comunicado ==='
do $$
declare n int; begin
  select count(*) into n from comunicado_anexos;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: colaborador baixou % anexo(s) do mural dos gestores', n;
  end if;
  raise notice 'ok: anexo invisivel para quem nao ve o comunicado';
end $$;

\echo '=== Colaborador NÃO pode publicar comunicado (deve falhar) ==='
do $$ begin
  insert into comunicados (conta_id, titulo, corpo, publico, autor_id, autor_nome)
  values ('11111111-1111-1111-1111-111111111111', 'Invadido', '', 'colaboradores',
          auth.uid(), 'Colab A');
  raise exception 'FALHA DE SEGURANCA: colaborador publicou no mural';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Gestor A: lê o mural dos gestores e o da equipe dele ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000002';
do $$
declare n int; begin
  select count(*) into n from comunicados where publico = 'gestores';
  if n <> 1 then
    raise exception 'FALHOU: gestor deveria ler 1 comunicado de gestores, leu %', n;
  end if;
  if not exists (select 1 from comunicados where equipe_id = 1) then
    raise exception 'FALHA: gestor nao leu o comunicado da propria equipe';
  end if;
  if exists (select 1 from comunicados where equipe_id = 2) then
    raise exception 'FALHA DE SEGURANCA: gestor leu o mural de equipe que nao gerencia';
  end if;
  raise notice 'ok: mural recortado para o gestor';
end $$;

\echo '=== Gestor NÃO pode publicar para os gestores (deve falhar) ==='
do $$ begin
  insert into comunicados (conta_id, titulo, corpo, publico, autor_id, autor_nome)
  values ('11111111-1111-1111-1111-111111111111', 'Subindo de nivel', '', 'gestores',
          auth.uid(), 'Gestor A');
  raise exception 'FALHA DE SEGURANCA: gestor publicou para os gestores';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Gestor NÃO pode publicar para equipe que não gerencia (deve falhar) ==='
do $$ begin
  insert into comunicados (conta_id, titulo, corpo, publico, equipe_id, autor_id, autor_nome)
  values ('11111111-1111-1111-1111-111111111111', 'Equipe alheia', '', 'colaboradores', 2,
          auth.uid(), 'Gestor A');
  raise exception 'FALHA DE SEGURANCA: gestor publicou para equipe alheia';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Gestor NÃO pode remover comunicado de outra pessoa (deve afetar 0 linhas) ==='
delete from comunicados where id = 1;
do $$ begin
  if not exists (select 1 from comunicados where id = 1) then
    raise exception 'FALHA DE SEGURANCA: gestor removeu comunicado da Planejadora';
  end if;
  raise notice 'ok: remocao restrita ao autor e ao Planejamento';
end $$;

\echo '=== Aviso não é lido por quem não é o destinatário — nem pelo gestor ==='
do $$
declare n int; begin
  select count(*) into n from avisos;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: gestor leu % aviso(s) endereçado(s) a outra pessoa', n;
  end if;
  raise notice 'ok: aviso invisivel para o gestor';
end $$;

\echo '=== Nem pelo Planejamento ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from avisos;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: Planejamento leu % aviso(s) alheio(s)', n;
  end if;
  raise notice 'ok: aviso invisivel para o Planejamento';
end $$;

\echo '=== Mas o destinatário lê o dele ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$
declare n int; begin
  select count(*) into n from avisos;
  if n <> 1 then
    raise exception 'FALHOU: destinatario deveria ver 1 aviso, viu %', n;
  end if;
  raise notice 'ok: aviso e do destinatario e de mais ninguem';
end $$;

\echo '=== Colaborador NÃO enxerga a caixa de saída de alterações (deve ser 0) ==='
do $$
declare n int; begin
  select count(*) into n from alteracoes_pendentes;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: colaborador viu % alteracao(oes) nao comunicada(s)', n;
  end if;
  raise notice 'ok: caixa de saida invisivel para o colaborador';
end $$;

\echo '=== Colaborador NÃO pode inserir alteração pendente (deve falhar) ==='
do $$ begin
  insert into alteracoes_pendentes (conta_id, geracao_id, colaborador_id, data, de, para, por_nome)
  values ('11111111-1111-1111-1111-111111111111', 1, 1, '2026-08-04', 'x', 'y', 'Colab A');
  raise exception 'FALHA DE SEGURANCA: colaborador escreveu na caixa de saida';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Conta B não enxerga nada do mural da conta A ==='
set request.jwt.claim.sub = 'bbbbbbb1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from comunicados;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: conta B leu % comunicado(s) da conta A', n;
  end if;
  select count(*) into n from comunicado_anexos;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: conta B leu % anexo(s) da conta A', n;
  end if;
  select count(*) into n from alteracoes_pendentes;
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: conta B leu % alteracao(oes) da conta A', n;
  end if;
  raise notice 'ok: conta B nao ve o mural nem a caixa de saida da conta A';
end $$;

-- ═══════════ Administrador Geral e Administrador da Área ═══════════
-- O ponto de todo este bloco: o papel mais poderoso do sistema é também o que
-- menos enxerga. Ele administra instâncias; quem administra pessoas é o
-- administrador de cada área.

\echo '\n=== Administrador Geral enxerga as duas áreas ==='
set request.jwt.claim.sub = 'ccccccc1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from contas;
  if n <> 2 then raise exception 'FALHOU: deveria ver 2 areas, viu %', n; end if;
  raise notice 'ok: as duas areas';
end $$;

\echo '=== Administrador Geral NÃO enxerga nada de dentro das áreas ==='
do $$
declare n int; begin
  select count(*) into n from colaboradores;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % colaborador(es)', n; end if;
  select count(*) into n from alocacoes;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % alocacao(oes)', n; end if;
  select count(*) into n from solicitacoes;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % solicitacao(oes)', n; end if;
  select count(*) into n from comunicados;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % comunicado(s)', n; end if;
  select count(*) into n from geracoes;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % geracao(oes)', n; end if;
  select count(*) into n from logs;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: geral leu % log(s) de area', n; end if;
  raise notice 'ok: conta_id nulo nega toda policy do dominio';
end $$;

\echo '=== …mas em perfis enxerga todos os usuários, de todas as áreas (0016) ==='
-- Até a 0015 este teste exigia o contrário: 3 perfis, só os administradores de
-- área. A 0016 ampliou de propósito — quem responde pelo sistema precisa saber
-- quem tem login nele. O limite da ampliação está no teste acima, que continua
-- valendo: os dados DE DENTRO da área (colaborador, escala, solicitação) seguem
-- fechados. Ver quem entra não é ver o que se faz lá dentro.
do $$
declare n int; begin
  select count(*) into n from perfis;
  if n <> 8 then raise exception 'FALHOU: deveria ver os 8 perfis da massa, viu %', n; end if;
  select count(*) into n from perfis where papel in ('planejamento', 'gestor', 'colaborador');
  if n <> 5 then raise exception 'FALHOU: deveria ver os 5 usuarios comuns das areas, viu %', n; end if;
  raise notice 'ok: todos os logins, de todas as areas';
end $$;

\echo '=== resumo_areas() dá os números das duas áreas, sem os dados ==='
do $$
declare r record; begin
  select count(*) as areas, sum(colaboradores) as colabs into r from resumo_areas();
  if r.areas <> 2 then raise exception 'FALHOU: resumo deveria trazer 2 areas, trouxe %', r.areas; end if;
  -- 3 na conta A (um deles desligado não existe nesta massa) e 1 na conta B.
  if r.colabs <> 4 then raise exception 'FALHOU: resumo deveria somar 4 colaboradores, somou %', r.colabs; end if;
  raise notice 'ok: contagem sem leitura';
end $$;

\echo '=== Administrador Geral cria área e nomeia o administrador dela ==='
insert into contas (id, nome) values ('33333333-3333-3333-3333-333333333333', 'Hospital C');
insert into perfis (id, conta_id, nome, email, papel) values
  ('ccccccc1-0000-0000-0000-000000000009', '33333333-3333-3333-3333-333333333333',
   'Admin C', 'admin@c.com', 'admin_local');
select count(*) as areas_apos_criar from contas;

\echo '=== …mas NÃO cria Planejamento direto (a corrente tem elos, deve falhar) ==='
do $$ begin
  insert into perfis (id, conta_id, nome, email, papel) values
    ('ccccccc1-0000-0000-0000-000000000008', '33333333-3333-3333-3333-333333333333',
     'Plan C', 'plan@c.com', 'planejamento');
  raise exception 'FALHA DE SEGURANCA: geral pulou o administrador da area';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Administrador da Área A: mesmo alcance de leitura do Planejamento ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000005';
do $$
declare n int; begin
  select count(*) into n from colaboradores;
  if n <> 3 then raise exception 'FALHOU: deveria ver os 3 da area A, viu %', n; end if;
  select count(*) into n from contas;
  if n <> 1 then raise exception 'FALHA DE SEGURANCA: admin local viu % area(s)', n; end if;
  raise notice 'ok: enxerga a propria area e so ela';
end $$;

\echo '=== Administrador da Área cria o Planejamento ==='
insert into perfis (id, conta_id, nome, email, papel) values
  ('aaaaaaa1-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Planejadora A2', 'plan2@a.com', 'planejamento');
select count(*) as perfis_da_area_a from perfis;

\echo '=== …mas NÃO nomeia outro Administrador da Área (deve falhar) ==='
do $$ begin
  insert into perfis (id, conta_id, nome, email, papel) values
    ('aaaaaaa1-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
     'Admin A2', 'admin2@a.com', 'admin_local');
  raise exception 'FALHA DE SEGURANCA: area nomeou o proprio administrador';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== …e NÃO cria área (deve falhar) ==='
do $$ begin
  insert into contas (nome) values ('Area pirata');
  raise exception 'FALHA DE SEGURANCA: admin local criou area';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Renomeia a própria área, mas NÃO a desativa (deve falhar) ==='
update contas set nome = 'Hospital A (renomeado)' where id = conta_id();
do $$ begin
  update contas set ativa = false where id = conta_id();
  raise exception 'FALHA DE SEGURANCA: area se desativou sozinha';
exception when insufficient_privilege then
  raise notice 'ok: ativa congelada para quem nao e o Geral';
end $$;

\echo '=== Ninguém apaga área — nem o Administrador Geral (deve afetar 0 linhas) ==='
delete from contas where id = conta_id();
set request.jwt.claim.sub = 'ccccccc1-0000-0000-0000-000000000001';
delete from contas where id = '33333333-3333-3333-3333-333333333333';
do $$
declare n int; begin
  select count(*) into n from contas;
  if n <> 3 then raise exception 'FALHA DE SEGURANCA: area apagada, sobraram %', n; end if;
  raise notice 'ok: sem policy de delete, o historico da area nao se perde';
end $$;

\echo '=== resumo_areas() não devolve nada para quem não é o Geral ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from resumo_areas();
  if n <> 0 then
    raise exception 'FALHA DE SEGURANCA: Planejamento leu o tamanho de % area(s)', n;
  end if;
  raise notice 'ok: security definer barra quem chama';
end $$;

\echo '=== Planejamento NÃO promove ninguém a Administrador da Área (deve falhar) ==='
do $$ begin
  update perfis set papel = 'admin_local' where id = 'aaaaaaa1-0000-0000-0000-000000000002';
  raise exception 'FALHA DE SEGURANCA: Planejamento nomeou administrador de area';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Planejamento NÃO enxerga o Administrador Geral nem cria área (deve falhar) ==='
do $$
declare n int; begin
  select count(*) into n from perfis where papel = 'admin_geral';
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: area enxergou o Administrador Geral'; end if;
  raise notice 'ok: o geral e invisivel de dentro da area';
end $$;
do $$ begin
  insert into contas (nome) values ('Area pirata 2');
  raise exception 'FALHA DE SEGURANCA: Planejamento criou area';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

\echo '=== Colaborador NÃO se promove a Administrador da Área (deve falhar) ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000003';
do $$ begin
  update perfis set papel = 'admin_local' where id = auth.uid();
  raise exception 'FALHA DE SEGURANCA: escalonamento para admin_local permitido';
exception when insufficient_privilege then
  raise notice 'ok: bloqueado pela RLS';
end $$;

-- ══════════════════════════════════════════════════════════════
-- 0016 — o Geral vê os usuários das áreas
-- ══════════════════════════════════════════════════════════════

\echo '=== O Geral vê os usuários de todas as áreas, e nada além disso ==='
set request.jwt.claim.sub = 'ccccccc1-0000-0000-0000-000000000001';
do $$
declare na int; nb int; n int;
begin
  select count(*) into na from perfis where conta_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into nb from perfis where conta_id = '22222222-2222-2222-2222-222222222222';
  if na < 5 or nb < 2 then
    raise exception 'FALHA: o Geral nao leu os usuarios das areas (A=%, B=%)', na, nb;
  end if;

  -- A linha que separa "ver quem entra" de "ver a operação": a ficha do
  -- colaborador, a escala e as solicitações continuam fechadas para ele.
  select count(*) into n from colaboradores;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: o Geral leu % colaborador(es)', n; end if;
  select count(*) into n from solicitacoes;
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: o Geral leu % solicitacao(oes)', n; end if;

  raise notice 'ok: le os logins das areas, nao a ficha de quem trabalha nelas';
end $$;

\echo '=== O Geral vê, mas NÃO altera, quem não é administrador de área ==='
do $$
declare p text; begin
  update perfis set papel = 'gestor' where id = 'aaaaaaa1-0000-0000-0000-000000000003';
  select papel into p from perfis where id = 'aaaaaaa1-0000-0000-0000-000000000003';
  if p <> 'colaborador' then
    raise exception 'FALHA DE SEGURANCA: o Geral mudou o papel de um colaborador para %', p;
  end if;
  raise notice 'ok: a 0016 ampliou a leitura e deixou a escrita como estava';
end $$;

\echo '=== A área continua sem enxergar os usuários da outra ==='
set request.jwt.claim.sub = 'aaaaaaa1-0000-0000-0000-000000000001';
do $$
declare n int; begin
  select count(*) into n from perfis where conta_id = '22222222-2222-2222-2222-222222222222';
  if n <> 0 then raise exception 'FALHA DE SEGURANCA: area A leu % usuario(s) da area B', n; end if;
  raise notice 'ok: a ampliacao vale so para o Geral';
end $$;

reset role;
\echo ''
\echo '>>> TODOS OS TESTES DE RLS PASSARAM'
