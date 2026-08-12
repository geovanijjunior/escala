-- Bateria de integridade do banco.
--
-- Complementa rls.sql. Enquanto aquele verifica QUEM enxerga o quê, este
-- verifica que o banco recusa dado inconsistente e que apagar um registro leva
-- junto o que precisa ir — e só o que precisa.
--
-- Como rodar (Postgres local com todas as migrations aplicadas):
--   psql -d escala -f supabase/tests/integridade.sql
--
-- Não rode em produção: apaga e recria massa de teste.
\set ON_ERROR_STOP on
\pset pager off

truncate contas cascade;
delete from auth.users;

insert into contas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Hospital A'),
  ('22222222-2222-2222-2222-222222222222', 'Hospital B');

insert into unidades (id, conta_id, codigo, nome, sigla, capacidade_total, capacidade_reservadas)
  overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'MOR', 'Morumbi',  'MOR', 10, 2),
  (2, '11111111-1111-1111-1111-111111111111', 'PAU', 'Paulista', 'PAU', 8, 0),
  (3, '22222222-2222-2222-2222-222222222222', 'CEN', 'Centro',   'CEN', 5, 0);

insert into equipes (id, conta_id, codigo, nome) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'EQ1', 'Técnicos'),
  (2, '11111111-1111-1111-1111-111111111111', 'EQ2', 'Analistas'),
  (3, '22222222-2222-2222-2222-222222222222', 'EQB', 'Equipe da conta B');

insert into colaboradores (id, conta_id, nome, matricula, equipe_id, unidade_base_id)
  overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 'Felipe', '001', 1, 1),
  (2, '11111111-1111-1111-1111-111111111111', 'Ana',    '002', 2, 1);

insert into postos (id, conta_id, unidade_id, nome) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, 'Corpo Clínico');

insert into planos (id, conta_id, colaborador_id, competencia) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, '2026-11-01');

-- Inserir id explícito com `overriding system value` NÃO avança a sequência de
-- identidade, então o próximo id gerado colidiria com a massa e o teste falharia
-- por chave duplicada em vez do motivo real. Sincroniza antes de começar.
do $$
declare t text; begin
  foreach t in array array['unidades','equipes','colaboradores','planos','postos','geracoes','solicitacoes'] loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, ''id''), coalesce((select max(id) from %I), 0) + 1, false)',
      t, t);
  end loop;
end $$;

-- Helper: espera que o bloco falhe, e opcionalmente pelo MOTIVO certo.
--
-- O `esperado` existe por causa de um falso-positivo real: o teste de vínculo
-- entre contas passou por meses sendo barrado pela unicidade de matrícula, e não
-- por proteção de multi-tenancy — que naquele momento não existia. Um teste que
-- passa pelo motivo errado é pior que teste nenhum, porque cria confiança.
create or replace function espera_recusa(rotulo text, sql text, esperado text default null)
returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FALHOU: % foi aceito e deveria ter sido recusado', rotulo;
exception
  when check_violation or foreign_key_violation or unique_violation or not_null_violation then
    if esperado is not null and sqlstate <> esperado then
      raise exception 'FALHOU: % recusado por % (esperado %) — passou pelo motivo errado',
        rotulo, sqlstate, esperado;
    end if;
    raise notice 'ok: % recusado (%)', rotulo, sqlstate;
end;
$$;

\echo '\n══════ RESTRIÇÕES DE DOMÍNIO ══════'

select espera_recusa('reservadas maiores que a capacidade total',
  $$insert into unidades (conta_id, codigo, nome, sigla, capacidade_total, capacidade_reservadas)
    values ('11111111-1111-1111-1111-111111111111','X','X','X', 5, 9)$$);

select espera_recusa('capacidade negativa',
  $$insert into unidades (conta_id, codigo, nome, sigla, capacidade_total)
    values ('11111111-1111-1111-1111-111111111111','Y','Y','Y', -1)$$);

select espera_recusa('código de unidade duplicado na mesma conta',
  $$insert into unidades (conta_id, codigo, nome, sigla)
    values ('11111111-1111-1111-1111-111111111111','MOR','Outro','OUT')$$);

select espera_recusa('regime fora do domínio',
  $$insert into equipes (conta_id, codigo, nome, regime)
    values ('11111111-1111-1111-1111-111111111111','EQX','X','8x4')$$);

select espera_recusa('ausência de zero dias',
  $$insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias)
    values ('11111111-1111-1111-1111-111111111111', 1, 'FERIAS', '2026-11-01', 0)$$);

select espera_recusa('ausência do tipo AUSENCIA sem grupo e motivo',
  $$insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias)
    values ('11111111-1111-1111-1111-111111111111', 1, 'AUSENCIA', '2026-11-01', 2)$$);

-- Troca de plantão SEM parceiro é aceita, e é isso que se verifica aqui.
--
-- Até a 0010 havia um check exigindo o parceiro na abertura, e este teste
-- cobrava a recusa. A 0010 derrubou a regra de propósito: quem pede a troca nem
-- sempre sabe com quem ela vai ser feita — é o Planejamento que encontra o par
-- ao encaixar na escala, e o nome é registrado depois, na ocorrência. O teste
-- ficou para trás e passou a falhar em qualquer banco corretamente migrado,
-- cobrando uma regra que o sistema não tem mais.
do $$
declare n int; begin
  insert into solicitacoes (conta_id, colaborador_id, tipo, data)
    values ('11111111-1111-1111-1111-111111111111', 1, 'TROCA_HORARIO', '2026-11-10');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU: troca de plantao sem parceiro deveria ser aceita'; end if;
  raise notice 'ok: troca de plantao sem parceiro aceita (o par vem na ocorrencia)';
end $$;

select espera_recusa('troca de plantão consigo mesmo',
  $$insert into solicitacoes (conta_id, colaborador_id, tipo, data, parceiro_id)
    values ('11111111-1111-1111-1111-111111111111', 1, 'TROCA_HORARIO', '2026-11-10', 1)$$);

select espera_recusa('período com fim antes do início',
  $$insert into solicitacoes (conta_id, colaborador_id, tipo, data, data_fim)
    values ('11111111-1111-1111-1111-111111111111', 1, 'FERIAS', '2026-11-20', '2026-11-10')$$);

select espera_recusa('período em tipo pontual',
  $$insert into solicitacoes (conta_id, colaborador_id, tipo, data, data_fim)
    values ('11111111-1111-1111-1111-111111111111', 1, 'AJUSTE_PONTO', '2026-11-10', '2026-11-12')$$);

select espera_recusa('status de solicitação inexistente',
  $$insert into solicitacoes (conta_id, colaborador_id, tipo, data, status)
    values ('11111111-1111-1111-1111-111111111111', 1, 'FOLGA', '2026-11-10', 'TALVEZ')$$);

select espera_recusa('posto com zero vagas',
  $$insert into postos (conta_id, unidade_id, nome, vagas)
    values ('11111111-1111-1111-1111-111111111111', 1, 'Sem vaga', 0)$$);

select espera_recusa('posto com nome duplicado na mesma unidade',
  $$insert into postos (conta_id, unidade_id, nome)
    values ('11111111-1111-1111-1111-111111111111', 1, 'Corpo Clínico')$$);

select espera_recusa('atribuição de posto com 6 dias',
  $$insert into plano_posto (conta_id, plano_id, posto_id, dias)
    values ('11111111-1111-1111-1111-111111111111', 1, 1, 6)$$);

select espera_recusa('mesmo posto atribuído duas vezes no mesmo plano', $$
  insert into plano_posto (conta_id, plano_id, posto_id, dias)
    values ('11111111-1111-1111-1111-111111111111', 1, 1, 3);
  insert into plano_posto (conta_id, plano_id, posto_id, dias)
    values ('11111111-1111-1111-1111-111111111111', 1, 1, 4);
$$);

select espera_recusa('cota de equipe negativa',
  $$insert into cotas_equipe (conta_id, unidade_id, equipe_id, limite)
    values ('11111111-1111-1111-1111-111111111111', 1, 1, -3)$$);

select espera_recusa('duas cotas gerais para o mesmo par unidade+equipe', $$
  insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, limite)
    values ('11111111-1111-1111-1111-111111111111', 2, 1, null, 3);
  insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, limite)
    values ('11111111-1111-1111-1111-111111111111', 2, 1, null, 5);
$$);

select espera_recusa('dia da semana fora de 0..6',
  $$insert into capacidades (conta_id, unidade_id, dow, total)
    values ('11111111-1111-1111-1111-111111111111', 1, 9, 5)$$);

select espera_recusa('capacidade sem dia da semana nem data',
  $$insert into capacidades (conta_id, unidade_id, total)
    values ('11111111-1111-1111-1111-111111111111', 1, 5)$$);

select espera_recusa('capacidade com dia da semana E data ao mesmo tempo',
  $$insert into capacidades (conta_id, unidade_id, dow, data, total)
    values ('11111111-1111-1111-1111-111111111111', 1, 3, '2026-11-10', 5)$$);

-- 23503 = foreign_key_violation. Exigir o código impede que este teste volte a
-- passar por acidente, como já aconteceu com a unicidade de matrícula (23505).
select espera_recusa('colaborador da conta B apontando para equipe da conta A',
  $$insert into colaboradores (conta_id, nome, matricula, equipe_id, unidade_base_id)
    values ('22222222-2222-2222-2222-222222222222', 'Intruso', '999', 1, 3)$$, '23503');

select espera_recusa('posto da conta B dentro de unidade da conta A',
  $$insert into postos (conta_id, unidade_id, nome)
    values ('22222222-2222-2222-2222-222222222222', 1, 'Invasor')$$, '23503');

select espera_recusa('cota da conta B sobre equipe da conta A',
  $$insert into cotas_equipe (conta_id, unidade_id, equipe_id, limite)
    values ('22222222-2222-2222-2222-222222222222', 3, 1, 2)$$, '23503');

select espera_recusa('solicitação com parceiro de outra conta', $$
  insert into colaboradores (id, conta_id, nome, matricula, equipe_id, unidade_base_id)
    overriding system value
    values (90, '22222222-2222-2222-2222-222222222222', 'B1', 'B1', 3, 3);
  insert into solicitacoes (conta_id, colaborador_id, tipo, data, parceiro_id)
    values ('11111111-1111-1111-1111-111111111111', 1, 'TROCA_HORARIO', '2026-11-10', 90);
$$, '23503');

\echo '\n══════ CASCATA E RETENÇÃO ══════'

-- Massa para observar o efeito de apagar.
insert into geracoes (id, conta_id, competencia, versao, status) overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', '2026-11-01', 1, 'publicada');
insert into alocacoes (conta_id, geracao_id, colaborador_id, data, modalidade, unidade_id, posto_id) values
  ('11111111-1111-1111-1111-111111111111', 1, 1, '2026-11-10', 'UNIDADE', 1, 1);
insert into plano_posto (conta_id, plano_id, posto_id, dias)
  values ('11111111-1111-1111-1111-111111111111', 1, 1, 3);

do $$
declare n int; begin
  -- Apagar o posto NÃO pode apagar a escala já gerada: o histórico do que
  -- aconteceu é registro, não configuração.
  delete from postos where id = 1;
  select count(*) into n from alocacoes where geracao_id = 1;
  if n <> 1 then raise exception 'FALHOU: apagar o posto levou a alocação junto'; end if;
  select count(*) into n from alocacoes where geracao_id = 1 and posto_id is not null;
  if n <> 0 then raise exception 'FALHOU: posto_id deveria virar nulo'; end if;
  raise notice 'ok: apagar posto preserva a alocação e anula posto_id';

  select count(*) into n from plano_posto;
  if n <> 0 then raise exception 'FALHOU: atribuição de posto no plano deveria cascatear'; end if;
  raise notice 'ok: apagar posto remove a atribuição do plano';
end $$;

do $$ begin
  -- Unidade com escala gerada é histórico: não se apaga, se desativa. Antes o
  -- ON DELETE SET NULL tentava anular unidade_id numa alocação de modalidade
  -- UNIDADE e a recusa vinha como violação de CHECK, mensagem que não diz nada
  -- a quem clicou em "excluir".
  begin
    delete from unidades where id = 1;
    raise exception 'FALHOU: apagou unidade com escala gerada';
  exception
    when foreign_key_violation then
      raise notice 'ok: unidade em uso é recusada por chave estrangeira (mensagem clara)';
    when check_violation then
      raise exception 'FALHOU: recusa veio como violação de CHECK, não de chave estrangeira';
  end;

  -- Mas desativar sempre funciona, que é o caminho correto.
  update unidades set ativa = false where id = 2;
  raise notice 'ok: desativar a unidade é sempre permitido';
end $$;

do $$
declare n int; begin
  -- Apagar a conta leva tudo dela, e nada da outra.
  delete from contas where id = '11111111-1111-1111-1111-111111111111';
  select count(*) into n from colaboradores;
  if n <> 0 then raise exception 'FALHOU: sobraram % colaboradores da conta apagada', n; end if;
  select count(*) into n from alocacoes;
  if n <> 0 then raise exception 'FALHOU: sobraram alocações órfãs'; end if;
  select count(*) into n from unidades where conta_id = '22222222-2222-2222-2222-222222222222';
  if n <> 1 then raise exception 'FALHOU: a conta B perdeu dados (% unidades)', n; end if;
  raise notice 'ok: apagar a conta leva tudo dela e nada da outra';
end $$;

drop function espera_recusa(text, text, text);

\echo ''
\echo '>>> TODOS OS TESTES DE INTEGRIDADE PASSARAM'
