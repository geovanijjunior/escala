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

reset role;
\echo ''
\echo '>>> TODOS OS TESTES DE RLS PASSARAM'
