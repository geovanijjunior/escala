-- =====================================================================
-- ZERAR A BASE DE TESTE — Jornada
-- =====================================================================
--
-- APAGA TODOS OS DADOS DA OPERAÇÃO e todos os usuários, preservando
-- apenas os três de teste nomeados abaixo e a área a que eles pertencem.
--
-- NÃO É UMA MIGRATION, e por isso mora fora de `supabase/migrations/`:
-- migration roda sozinha em todo deploy, e uma que apaga tudo encontraria
-- um dia a base errada. Este arquivo só roda quando alguém o cola no SQL
-- Editor do Supabase e manda rodar.
--
-- Como rodar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
--
-- O QUE SOBREVIVE
--   · a área (conta) dos três usuários, com o nome e a configuração dela
--   · os três perfis de teste, com o papel acertado pelo próprio e-mail
--   · os feriados nacionais, re-semeados no fim (o gatilho que os cria só
--     dispara em área nova, então aqui eles são repostos à mão)
--
-- O QUE VAI EMBORA
--   · todos os outros usuários, inclusive do Supabase Auth
--   · colaboradores, equipes, unidades, postos, capacidades e cotas
--   · planos do mês, férias e ausências
--   · escalas geradas, alocações, travas e alterações pendentes
--   · solicitações e todo o histórico de decisão delas
--   · ocorrências, comunicados com anexos, avisos, notificações e logs
--
-- DEPOIS DE RODAR, LEIA ISTO
--   Os usuários de gestor e de colaborador ficam SEM registro de
--   colaborador — ele foi apagado junto com o resto. O colaborador não
--   verá escala nenhuma e o gestor não terá equipe, porque nenhum dos
--   dois existe mais como pessoa da operação, só como login.
--
--   A tela cria o vínculo no CONVITE do usuário, não depois. Então há
--   dois caminhos: apagar esses dois usuários e convidá-los de novo pela
--   tela de Usuários, ou rodar `semear-base-de-teste.sql`, ao lado deste,
--   que recria o mínimo (uma unidade, uma equipe e os dois registros de
--   colaborador já vinculados).
--
-- É IRREVERSÍVEL. Não há cópia de segurança embutida aqui: se a base tiver
-- algo que você queira de volta, exporte antes.
-- =====================================================================

begin;

-- ── Quem fica ────────────────────────────────────────────────────────
create temp table _manter (email text primary key) on commit drop;
insert into _manter (email) values
  ('teste_colaborador@teste.com'),
  ('teste_gestor@teste.com'),
  ('teste_planejamento@teste.com');

-- ── Conferência antes de apagar qualquer coisa ───────────────────────
--
-- Se um dos três não existir, o script PARA aqui e nada é apagado. Sem
-- esta trava, um e-mail digitado errado apagaria também o usuário que se
-- queria manter — e como os perfis somem junto, ninguém mais entraria no
-- sistema para consertar. É o erro que não dá para desfazer pela tela.
do $$
declare faltando text;
begin
  select string_agg(m.email, ', ' order by m.email) into faltando
    from _manter m
    left join auth.users u on lower(u.email) = m.email
   where u.id is null;

  if faltando is not null then
    raise exception
      'PAREI: estes usuários não existem em auth.users: %. Crie-os antes (ou corrija o e-mail no script) — nada foi apagado.',
      faltando;
  end if;
end $$;

-- E cada um precisa ter perfil, senão sobra login sem acesso a nada.
do $$
declare sem_perfil text;
begin
  select string_agg(u.email, ', ' order by u.email) into sem_perfil
    from auth.users u
    join _manter m on lower(u.email) = m.email
    left join perfis p on p.id = u.id
   where p.id is null;

  if sem_perfil is not null then
    raise exception
      'PAREI: estes usuários existem no Auth mas não têm perfil: %. Sem perfil eles não entram no sistema, e apagar o resto deixaria a base sem ninguém — nada foi apagado.',
      sem_perfil;
  end if;
end $$;

-- ── 1. Os demais usuários ────────────────────────────────────────────
-- `perfis.id` referencia `auth.users(id) on delete cascade`, então o
-- perfil sai junto com o usuário. Apagar daqui, e não de `perfis`, é o
-- que evita deixar login órfão que autentica e não acha sessão.
delete from auth.users u
 where lower(u.email) not in (select email from _manter);

-- ── 2. Juntar os três na MESMA área ──────────────────────────────────
--
-- Isto não é capricho de arrumação: sem ele a base fica intestável.
--
-- O gatilho `handle_novo_usuario` (0001) tem dois caminhos. Quem é
-- convidado pela tela de Usuários chega com `conta_id` nos metadados e
-- entra na área de quem convidou. Quem é criado DIRETO no painel do
-- Supabase Auth não traz nada disso — e cai no `else`, que cria uma área
-- NOVA e o torna `planejamento` dela.
--
-- Três usuários criados assim viram três inquilinos isolados. A RLS
-- recorta tudo por área, então o planejamento não enxerga o colaborador,
-- o gestor não tem a quem aprovar, e o fluxo que se queria testar —
-- abrir pedido, triar, aprovar, gerar — não acontece em lugar nenhum.
-- A tela não mostra o problema: cada um entra e vê um sistema vazio,
-- que se parece com base recém-limpa.
--
-- A área do usuário de planejamento é a que fica, por ser a dele o
-- lugar de onde tudo se configura.
do $$
declare
  destino uuid;
  mudados int;
begin
  select p.conta_id into destino
    from perfis p
   where lower(p.email) = 'teste_planejamento@teste.com';

  update perfis set conta_id = destino
   where lower(email) in (select email from _manter)
     and conta_id is distinct from destino;
  get diagnostics mudados = row_count;

  if mudados > 0 then
    raise notice 'Os três usuários estavam em áreas separadas; % foi(ram) movido(s) para a área do planejamento.', mudados;
  end if;

  -- A área criada pelo gatilho herda o e-mail como nome. Num sistema em
  -- que o nome da área é o descritor da marca no topo da tela, isso fica
  -- estranho — e só acontece quando ninguém a nomeou.
  update contas set nome = 'Área de Teste'
   where id = destino and nome like '%@%';
end $$;

-- ── 3. Áreas que ficaram sem ninguém ─────────────────────────────────
-- Cascata: leva TODOS os dados da área junto. Áreas de teste criadas e
-- abandonadas somem inteiras aqui — inclusive as que o gatilho criou
-- para os usuários que acabaram de ser reunidos acima.
delete from contas c
 where not exists (select 1 from perfis p where p.conta_id = c.id);

-- ── 4. Os dados da área que sobrou ───────────────────────────────────
--
-- A ordem não é estética. `colaboradores.equipe_id` e
-- `colaboradores.unidade_base_id` são `on delete restrict`: apagar equipe
-- ou unidade antes das pessoas falha, e a mensagem do banco fala de chave
-- estrangeira, não de ordem. Pessoas primeiro, cadastro depois.
delete from solicitacao_eventos;
delete from solicitacoes;

delete from alteracoes_pendentes;
delete from ocorrencias;
delete from pins;
delete from alocacoes;
delete from geracoes;

delete from ausencias;
delete from plano_posto;
delete from plano_unidade_fixa;
delete from plano_distribuicao;
delete from planos;

delete from comunicado_anexos;   -- o arquivo é `bytea` na própria linha:
delete from comunicados;         -- não fica nada no Storage para limpar
delete from notificacoes_lidas;
delete from avisos;
delete from logs;

delete from colaboradores;
delete from cotas_equipe;
delete from capacidades;
delete from postos;
delete from equipes;
delete from unidades;
delete from feriados;

-- ── 5. O papel de cada um dos três ───────────────────────────────────
-- Tirado do próprio e-mail, que não deixa dúvida. É idempotente: se já
-- estavam certos, não muda nada. `bloqueado` e `precisa_trocar_senha`
-- voltam ao normal para que os três entrem direto.
update perfis set
  papel = case lower(email)
    when 'teste_planejamento@teste.com' then 'planejamento'
    when 'teste_gestor@teste.com'       then 'gestor'
    else                                     'colaborador'
  end,
  bloqueado = false,
  precisa_trocar_senha = false
 where lower(email) in (select email from _manter);

-- ── 6. Feriados nacionais de volta ───────────────────────────────────
-- O gatilho `contas_feriados` só dispara quando uma ÁREA é criada, e
-- nenhuma foi. Sem isto a escala do ano inteiro seria gerada sem feriado
-- nenhum — e o erro só apareceria em dezembro.
do $$
declare
  a uuid;
  ano int := extract(year from current_date)::int;
begin
  for a in select id from contas loop
    perform semear_feriados_nacionais(a, ano);
    perform semear_feriados_nacionais(a, ano + 1);
  end loop;
end $$;

commit;

-- ── O que ficou de pé ────────────────────────────────────────────────
select 'areas'         as o_que, count(*) as quantos from contas
union all select 'usuarios (auth)',  count(*) from auth.users
union all select 'perfis',           count(*) from perfis
union all select 'colaboradores',    count(*) from colaboradores
union all select 'equipes',          count(*) from equipes
union all select 'unidades',         count(*) from unidades
union all select 'feriados',         count(*) from feriados
union all select 'solicitacoes',     count(*) from solicitacoes
union all select 'escalas geradas',  count(*) from geracoes
order by o_que;
