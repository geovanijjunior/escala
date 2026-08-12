-- Jornada — Administrador Geral, Administrador Local e áreas.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 0. Área é a conta
-- ══════════════════════════════════════════════════════════════
-- "Área" não é uma tabela nova. É o nome que a organização isolada passa a ter
-- na interface: `contas` sempre foi exatamente isso — uma instância com seus
-- próprios colaboradores, escalas e solicitações, que a RLS impede de enxergar
-- as outras. Criar uma segunda dimensão de isolamento dentro da primeira
-- duplicaria toda a lógica de recorte, com duas chances de discordarem.
--
-- O que muda é que agora existe alguém ACIMA das áreas.
alter table contas add column if not exists ativa boolean not null default true;

-- ══════════════════════════════════════════════════════════════
-- 1. Os dois papéis novos
-- ══════════════════════════════════════════════════════════════
--   admin_geral — responde pelo sistema. Cria a área e o administrador dela.
--                 NÃO enxerga dado de dentro de área nenhuma.
--   admin_local — responde por uma área. Cria o Planejamento e cuida dos
--                 cadastros de base. Não monta plano nem gera escala.
alter table perfis drop constraint if exists perfis_papel_check;
alter table perfis add constraint perfis_papel_check
  check (papel in ('admin_geral', 'admin_local', 'planejamento', 'gestor', 'colaborador'));

-- O Administrador Geral não pertence a área nenhuma, e é isso que o mantém
-- fora dos dados: TODA policy do domínio compara `conta_id = conta_id()`, e
-- com `conta_id` nulo essa comparação é nula — que em RLS nega. O privilégio
-- dele precisa ser concedido peça por peça, e o padrão é não ver nada. Um
-- papel poderoso deve falhar para o lado fechado.
alter table perfis alter column conta_id drop not null;

create or replace function eh_admin_geral() returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select papel from perfis where id = auth.uid()) = 'admin_geral', false) $$;

create or replace function eh_admin_local() returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select papel from perfis where id = auth.uid()) = 'admin_local', false) $$;

-- ══════════════════════════════════════════════════════════════
-- 2. Áreas: quem lista, cria e desativa
-- ══════════════════════════════════════════════════════════════
drop policy if exists contas_select on contas;
create policy contas_select on contas for select
  using (id = conta_id() or eh_admin_geral());

drop policy if exists contas_insert on contas;
create policy contas_insert on contas for insert
  with check (eh_admin_geral());

-- De dentro da área continua-se podendo renomeá-la, mas NÃO desativá-la: o
-- `ativa` fica congelado para quem não é o Geral, no mesmo estilo de
-- `perfis_update_self`. Sem esse congelamento, um Planejamento distraído
-- trancaria a própria organização do lado de fora — inclusive a si mesmo — e só
-- o Administrador Geral poderia desfazer. Ligar e desligar uma área é decisão
-- de quem administra o sistema.
--
-- `eh_planejamento()` aqui já cobre o administrador da área: a função foi
-- redefinida mais abaixo para valer para os dois.
drop policy if exists contas_update on contas;
create policy contas_update on contas for update
  using ((id = conta_id() and eh_planejamento()) or eh_admin_geral())
  with check (
    eh_admin_geral()
    or (
      id = conta_id() and eh_planejamento()
      and ativa = (select c.ativa from contas c where c.id = contas.id)
    )
  );

-- Área não se apaga: apagar levaria junto, em cascata, a escala inteira de uma
-- operação — inclusive o histórico de meses fechados, que é registro
-- trabalhista. Desativar tira do ar e preserva. Por isso não há policy de
-- delete: sem ela, `delete` é negado para todo mundo, que é o que se quer.

-- ══════════════════════════════════════════════════════════════
-- 3. Perfis: quem cria quem
-- ══════════════════════════════════════════════════════════════
-- A hierarquia de cadastro é uma corrente: geral → local → planejamento →
-- (gestor, colaborador). Cada elo só cria o próximo, e a regra vive aqui, no
-- banco, porque esconder o botão não impede um POST.
drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select
  using (
    id = auth.uid()
    or conta_id = conta_id()
    -- O Administrador Geral lê apenas os administradores locais. O resto dos
    -- perfis de uma área é dado de pessoa de outra organização, e ele não tem
    -- o que fazer com isso.
    or (eh_admin_geral() and papel = 'admin_local')
  );

-- As policies de 0001 são SUBSTITUÍDAS, não completadas.
--
-- Policies permissivas se somam com OR: deixar `perfis_insert_planejamento`
-- (`conta_id = conta_id() and eh_planejamento()`) no ar anularia toda a corrente
-- desenhada abaixo, porque `eh_planejamento()` passa a valer também para o
-- administrador local — e ele nomearia outro administrador local, que é
-- exatamente o que a corrente existe para impedir. Uma policy esquecida não dá
-- erro em lugar nenhum: ela só abre a porta.
drop policy if exists perfis_insert_planejamento on perfis;
drop policy if exists perfis_update_planejamento on perfis;

drop policy if exists perfis_insert on perfis;
create policy perfis_insert on perfis for insert
  with check (
    (eh_admin_geral() and papel = 'admin_local')
    or (eh_admin_local() and conta_id = conta_id() and papel in ('planejamento', 'gestor', 'colaborador'))
    or (papel() = 'planejamento' and conta_id = conta_id() and papel in ('gestor', 'colaborador', 'planejamento'))
  );

-- Sem o ramo `id = auth.uid()`, de propósito.
--
-- Quem altera a própria linha continua passando por `perfis_update_self`
-- (0001/0007), que congela `papel`, `conta_id`, `bloqueado` e
-- `precisa_trocar_senha` e deixa livre só o que a pessoa de fato ajusta — o
-- instante em que leu o sino e o mural. Repetir `id = auth.uid()` aqui, sem as
-- colunas congeladas, reabriria por OR o escalonamento de privilégio que aquela
-- policy fecha: um colaborador batendo direto na API viraria administrador.
drop policy if exists perfis_update on perfis;
create policy perfis_update on perfis for update
  using (
    (eh_admin_geral() and papel = 'admin_local')
    or (eh_admin_local() and conta_id = conta_id() and papel <> 'admin_local')
    or (papel() = 'planejamento' and conta_id = conta_id() and papel in ('gestor', 'colaborador', 'planejamento'))
  )
  with check (
    (eh_admin_geral() and papel = 'admin_local')
    or (eh_admin_local() and conta_id = conta_id() and papel <> 'admin_local')
    or (papel() = 'planejamento' and conta_id = conta_id() and papel in ('gestor', 'colaborador', 'planejamento'))
  );

-- `conta_id` agora pode ser nulo, e `null = null` é nulo — que em RLS nega. Com
-- a comparação por igualdade, o Administrador Geral não conseguiria marcar o
-- próprio sino como lido. `is not distinct from` compara nulos como iguais e
-- mantém o congelamento intacto para todo mundo.
drop policy if exists perfis_update_self on perfis;
create policy perfis_update_self on perfis for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel = (select p.papel from perfis p where p.id = auth.uid())
    and conta_id is not distinct from (select p.conta_id from perfis p where p.id = auth.uid())
    and bloqueado = (select p.bloqueado from perfis p where p.id = auth.uid())
    and precisa_trocar_senha = (select p.precisa_trocar_senha from perfis p where p.id = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════
-- 4. O Administrador Local herda o alcance do Planejamento
-- ══════════════════════════════════════════════════════════════
-- `eh_planejamento()` é chamada por dezenas de policies de cadastro. Em vez de
-- acrescentar `or eh_admin_local()` em cada uma — e esquecer de uma —, o
-- alcance dos dois passa a ser o mesmo aqui. A diferença entre eles NÃO é o
-- que enxergam: é o que a interface oferece a cada um, e é o que a checagem
-- das Server Actions cobra.
--
-- Vale registrar a escolha: dar ao Administrador Local o mesmo alcance de
-- leitura do Planejamento é deliberado. Quem responde pela área precisa poder
-- conferir o que foi configurado nela; separar os dois no banco criaria um
-- administrador que não consegue auditar a própria área.
create or replace function eh_planejamento() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select papel from perfis where id = auth.uid()) in ('planejamento', 'admin_local'), false)
$$;

-- `pode_ver_colaborador()` não passa por `eh_planejamento()`: é um `case
-- papel()`, e um papel que não está listado cai no `else false`. Sem esta
-- redefinição o Administrador da Área conseguiria CRIAR um colaborador (a
-- escrita passa por `eh_planejamento()`) e não conseguiria vê-lo depois — a
-- tela de cadastro salvaria e voltaria vazia, que é a pior forma de errar.
create or replace function pode_ver_colaborador(p_colab bigint) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when papel() in ('planejamento', 'admin_local') then exists (
      select 1 from colaboradores c where c.id = p_colab and c.conta_id = conta_id())
    when papel() = 'gestor' then exists (
      select 1 from colaboradores c
        join equipes e on e.id = c.equipe_id
      where c.id = p_colab and c.conta_id = conta_id()
        and (e.gestor_id = auth.uid() or c.gestor_id = auth.uid()))
    when papel() = 'colaborador' then exists (
      select 1 from colaboradores c
      where c.id = p_colab and c.conta_id = conta_id() and c.perfil_id = auth.uid())
    else false
  end
$$;

-- As três policies que listam papéis à mão em vez de chamar `eh_planejamento()`.
-- Sem elas, os indicadores da área abririam com "nenhuma escala gerada" no mês
-- em que a escala ainda é rascunho, e o administrador não leria o log da
-- própria área — inclusive o que registra o que o Administrador Geral fez nela.
drop policy if exists geracoes_select on geracoes;
create policy geracoes_select on geracoes for select
  using (conta_id = conta_id()
         and (status <> 'rascunho' or papel() in ('planejamento', 'admin_local', 'gestor')));

drop policy if exists alocacoes_select on alocacoes;
create policy alocacoes_select on alocacoes for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id)
         and exists (select 1 from geracoes g where g.id = geracao_id
                     and (g.status <> 'rascunho' or papel() in ('planejamento', 'admin_local', 'gestor'))));

drop policy if exists logs_select on logs;
create policy logs_select on logs for select
  using (conta_id = conta_id() and papel() in ('planejamento', 'admin_local', 'gestor'));

-- ══════════════════════════════════════════════════════════════
-- 5. O resumo das áreas, sem abrir as áreas
-- ══════════════════════════════════════════════════════════════
-- O Administrador Geral precisa saber se uma área está viva: quantas pessoas
-- tem, se a escala do mês foi publicada. Isso é contagem, não leitura de dado
-- pessoal.
--
-- Uma função `security definer` que devolve SÓ números é o jeito certo de dar
-- isso. A alternativa seria abrir exceção na RLS de `colaboradores` e de
-- `geracoes`, e uma exceção aberta para contar é uma exceção aberta para ler.
create or replace function resumo_areas()
returns table (
  conta_id uuid,
  nome text,
  ativa boolean,
  criado_em timestamptz,
  colaboradores bigint,
  usuarios bigint,
  admins_locais bigint,
  competencia_publicada date
)
language sql stable security definer
set search_path = public
as $$
  select
    c.id,
    c.nome,
    c.ativa,
    c.criado_em,
    (select count(*) from colaboradores x where x.conta_id = c.id and x.status = 'ativo'),
    (select count(*) from perfis p where p.conta_id = c.id),
    (select count(*) from perfis p where p.conta_id = c.id and p.papel = 'admin_local'),
    (select max(g.competencia) from geracoes g where g.conta_id = c.id and g.status = 'publicada')
  from contas c
  -- A função é security definer, então ela mesma precisa barrar quem não pode
  -- chamá-la: sem esta linha, qualquer sessão autenticada leria o tamanho de
  -- todas as organizações do sistema.
  where eh_admin_geral()
  order by c.nome
$$;

revoke all on function resumo_areas() from public;

-- `authenticated` é papel do Supabase e não existe num Postgres nu — o mesmo
-- em que esta migration roda nos testes. Sem a checagem, o arquivo inteiro
-- aborta aqui e as policies acima ficam pela metade, que é o pior resultado
-- possível para um script de segurança.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function resumo_areas() to authenticated;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 6. O cadastro pela tela de criar organização segue existindo
-- ══════════════════════════════════════════════════════════════
-- Quem se cadastra sozinho continua virando Planejamento da própria conta —
-- é o caminho de quem experimenta o sistema. O que muda é que um convite pode
-- agora trazer os papéis novos, e que um Administrador Geral não tem conta.
create or replace function handle_novo_usuario() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_conta_existente uuid;
  v_papel text;
begin
  v_conta_existente := (new.raw_user_meta_data->>'conta_id')::uuid;
  v_papel := coalesce(new.raw_user_meta_data->>'papel', 'colaborador');

  -- Administrador Geral não pertence a área nenhuma.
  if v_papel = 'admin_geral' then
    insert into perfis (id, conta_id, nome, email, papel, precisa_trocar_senha)
    values (
      new.id, null,
      coalesce(new.raw_user_meta_data->>'nome', new.email),
      new.email, 'admin_geral',
      coalesce((new.raw_user_meta_data->>'precisa_trocar_senha')::boolean, false)
    );
  elsif v_conta_existente is not null then
    insert into perfis (id, conta_id, nome, email, papel, precisa_trocar_senha)
    values (
      new.id, v_conta_existente,
      coalesce(new.raw_user_meta_data->>'nome', new.email),
      new.email, v_papel,
      coalesce((new.raw_user_meta_data->>'precisa_trocar_senha')::boolean, false)
    );
  else
    insert into contas (nome)
    values (coalesce(new.raw_user_meta_data->>'organizacao', new.raw_user_meta_data->>'nome', new.email))
    returning id into v_conta_id;

    insert into perfis (id, conta_id, nome, email, papel)
    values (new.id, v_conta_id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email, 'planejamento');
  end if;

  return new;
end;
$$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
