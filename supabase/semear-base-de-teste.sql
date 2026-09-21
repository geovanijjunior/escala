-- =====================================================================
-- SEMEAR O MÍNIMO PARA OS TRÊS USUÁRIOS DE TESTE — Jornada
-- =====================================================================
--
-- OPCIONAL, e feito para rodar logo depois de `zerar-base-de-teste.sql`.
--
-- POR QUE EXISTE
--   A limpeza apaga os registros de colaborador junto com o resto, e o
--   vínculo entre um login e a pessoa da operação é criado no CONVITE do
--   usuário — não há tela para ligar um usuário que já existe a um
--   colaborador novo. Sem este script, depois de zerar a base o usuário
--   de colaborador entra e não vê escala nenhuma, e o de gestor não tem
--   equipe: os dois viraram login sem pessoa por trás.
--
--   A alternativa é apagar esses dois usuários e convidá-los de novo pela
--   tela de Usuários, que faz o vínculo sozinha. Este script é o atalho
--   para quem quer manter as mesmas senhas e os mesmos e-mails.
--
-- O QUE CRIA (e só isto — o resto se cadastra pela tela)
--   · 1 unidade ativa, com capacidade para caber gente
--   · 1 equipe 5x2 diurna, com o usuário de gestor como gestor dela
--   · 2 colaboradores: um para o usuário de gestor, um para o de
--     colaborador, ambos já vinculados ao login
--
-- É seguro rodar de novo: se os registros já existirem, nada é duplicado.
-- =====================================================================

begin;

-- ── De quem estamos falando ──────────────────────────────────────────
create temp table _quem on commit drop as
select
  (select p.id from perfis p where lower(p.email) = 'teste_planejamento@teste.com') as planejamento,
  (select p.id from perfis p where lower(p.email) = 'teste_gestor@teste.com')       as gestor,
  (select p.id from perfis p where lower(p.email) = 'teste_colaborador@teste.com')  as colaborador,
  (select p.conta_id from perfis p where lower(p.email) = 'teste_planejamento@teste.com') as conta;

do $$
declare q record;
begin
  select * into q from _quem;
  if q.conta is null or q.gestor is null or q.colaborador is null then
    raise exception
      'PAREI: não achei os três perfis de teste. Rode `zerar-base-de-teste.sql` antes, ou confira os e-mails — nada foi criado.';
  end if;
end $$;

-- ── Unidade ──────────────────────────────────────────────────────────
-- `codigo` é gerado por gatilho desde a 0018, então não vai aqui.
insert into unidades (conta_id, nome, sigla, capacidade_total, capacidade_reservadas, ordem)
select q.conta, 'Unidade de Teste', 'TST', 20, 0, 1
  from _quem q
 where not exists (
   select 1 from unidades u where u.conta_id = q.conta and u.sigla = 'TST'
 );

-- ── Equipe, com o gestor de teste à frente ───────────────────────────
insert into equipes (conta_id, nome, regime, turno, gestor_id)
select q.conta, 'Equipe de Teste', '5x2', 'D', q.gestor
  from _quem q
 where not exists (
   select 1 from equipes e where e.conta_id = q.conta and e.nome = 'Equipe de Teste'
 );

-- ── As duas pessoas, já ligadas ao login ─────────────────────────────
--
-- O gestor também é uma PESSOA da operação, não só um aprovador: sem
-- registro de colaborador ele não aparece em escala nenhuma, e metade do
-- que há para testar com ele é justamente ver-se na grade.
insert into colaboradores (
  conta_id, perfil_id, nome, matricula, email, cargo,
  equipe_id, gestor_id, regime, turno, entrada, saida, unidade_base_id
)
select
  q.conta, q.gestor, p.nome, 'TST-001', p.email, 'Gestor de Teste',
  e.id, q.gestor, '5x2', 'D', '08:00', '17:00', u.id
  from _quem q
  join perfis   p on p.id = q.gestor
  join equipes  e on e.conta_id = q.conta and e.nome = 'Equipe de Teste'
  join unidades u on u.conta_id = q.conta and u.sigla = 'TST'
 where not exists (
   select 1 from colaboradores c where c.perfil_id = q.gestor
 );

insert into colaboradores (
  conta_id, perfil_id, nome, matricula, email, cargo,
  equipe_id, gestor_id, regime, turno, entrada, saida, unidade_base_id
)
select
  q.conta, q.colaborador, p.nome, 'TST-002', p.email, 'Analista de Teste',
  e.id, q.gestor, '5x2', 'D', '08:00', '17:00', u.id
  from _quem q
  join perfis   p on p.id = q.colaborador
  join equipes  e on e.conta_id = q.conta and e.nome = 'Equipe de Teste'
  join unidades u on u.conta_id = q.conta and u.sigla = 'TST'
 where not exists (
   select 1 from colaboradores c where c.perfil_id = q.colaborador
 );

commit;

-- ── Como ficou ───────────────────────────────────────────────────────
select c.nome, c.matricula, c.cargo, e.nome as equipe, u.nome as unidade,
       p.email, p.papel
  from colaboradores c
  join equipes  e on e.id = c.equipe_id
  join unidades u on u.id = c.unidade_base_id
  left join perfis p on p.id = c.perfil_id
 order by c.matricula;
