-- Escala — avisos de alteração da escala e mural de comunicados.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 0. Helpers de recorte
-- ══════════════════════════════════════════════════════════════

/** A equipe do colaborador ligado ao usuário logado. Nulo para quem não é. */
create or replace function minha_equipe() returns bigint
language sql stable security definer
set search_path = public
as $$ select equipe_id from colaboradores where perfil_id = auth.uid() limit 1 $$;

/** As equipes que o usuário logado gerencia. */
create or replace function minhas_equipes_geridas() returns setof bigint
language sql stable security definer
set search_path = public
as $$ select id from equipes where gestor_id = auth.uid() $$;

-- ══════════════════════════════════════════════════════════════
-- 1. Avisos — o que o sino mostra além do fluxo de solicitações
-- ══════════════════════════════════════════════════════════════
-- O sino lia só `solicitacao_eventos`, então uma alteração manual na escala
-- publicada não avisava ninguém: a pessoa descobria no dia, ao chegar no lugar
-- errado. Aqui cada aviso tem destinatário explícito, em vez de ser deduzido
-- por policy — quem muda a escala escolhe quem precisa saber.
create table if not exists avisos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  perfil_id uuid not null references perfis(id) on delete cascade,
  titulo text not null,
  detalhe text not null default '',
  rota text not null default '/',
  por_id uuid references perfis(id) on delete set null,
  por_nome text not null default '',
  criado_em timestamptz not null default now()
);

create index if not exists avisos_destinatario_idx on avisos(perfil_id, criado_em desc);
create index if not exists avisos_conta_idx on avisos(conta_id);

alter table avisos enable row level security;

drop policy if exists avisos_select on avisos;
create policy avisos_select on avisos for select
  using (conta_id = conta_id() and perfil_id = auth.uid());

-- Qualquer pessoa da conta pode gerar aviso para outra: é o efeito de uma ação
-- que ela já tinha permissão de fazer (mover alguém, publicar comunicado). A
-- permissão fica na ação, não aqui.
drop policy if exists avisos_insert on avisos;
create policy avisos_insert on avisos for insert
  with check (conta_id = conta_id());

-- ══════════════════════════════════════════════════════════════
-- 2. Mural de comunicados
-- ══════════════════════════════════════════════════════════════
-- `publico` diz a quem o comunicado se dirige; `equipe_id` estreita para uma
-- equipe. Gestor publica para a própria equipe; Planejamento publica para
-- qualquer equipe, para todos os colaboradores, ou para os gestores.
create table if not exists comunicados (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  titulo text not null,
  corpo text not null default '',
  publico text not null check (publico in ('colaboradores', 'gestores')),
  equipe_id bigint,
  fixado boolean not null default false,
  autor_id uuid references perfis(id) on delete set null,
  autor_nome text not null default '',
  criado_em timestamptz not null default now()
);

create index if not exists comunicados_conta_idx on comunicados(conta_id, criado_em desc);

-- FK no padrão vigente: composta quando a 0009 já rodou, simples quando não.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comunicados_equipe_fk') then
    if exists (select 1 from pg_constraint where conname = 'equipes_id_conta_id_key') then
      alter table comunicados add constraint comunicados_equipe_fk
        foreign key (equipe_id, conta_id) references equipes(id, conta_id) on delete set null (equipe_id);
    else
      alter table comunicados add constraint comunicados_equipe_fk
        foreign key (equipe_id) references equipes(id) on delete set null;
    end if;
  end if;
end $$;

alter table comunicados enable row level security;

drop policy if exists comunicados_select on comunicados;
create policy comunicados_select on comunicados for select
  using (
    conta_id = conta_id() and (
      papel() = 'planejamento'
      -- O gestor lê o mural dos gestores e também o que foi dito à equipe dele:
      -- ser cobrado por um comunicado que não pôde ler seria o pior arranjo.
      or (papel() = 'gestor' and (
            publico = 'gestores'
            or equipe_id is null
            or equipe_id in (select minhas_equipes_geridas())))
      or (papel() = 'colaborador' and publico = 'colaboradores'
          and (equipe_id is null or equipe_id = minha_equipe()))
    )
  );

-- Colaborador não publica. Gestor publica só para colaboradores, e só da
-- equipe que gerencia — a checagem fica aqui, não só na tela.
drop policy if exists comunicados_insert on comunicados;
create policy comunicados_insert on comunicados for insert
  with check (
    conta_id = conta_id() and (
      papel() = 'planejamento'
      or (papel() = 'gestor' and publico = 'colaboradores'
          and equipe_id in (select minhas_equipes_geridas()))
    )
  );

drop policy if exists comunicados_update on comunicados;
create policy comunicados_update on comunicados for update
  using (conta_id = conta_id() and (papel() = 'planejamento' or autor_id = auth.uid()));

drop policy if exists comunicados_delete on comunicados;
create policy comunicados_delete on comunicados for delete
  using (conta_id = conta_id() and (papel() = 'planejamento' or autor_id = auth.uid()));

-- ══════════════════════════════════════════════════════════════
-- 3. Anexos do comunicado
-- ══════════════════════════════════════════════════════════════
-- O conteúdo fica no banco, em bytea, e não no Storage. É uma troca
-- deliberada: o mural recebe foto de aviso e PDF de uma ou duas páginas, com
-- teto de 2 MB por arquivo, e guardar aqui dispensa criar bucket, políticas de
-- storage e URL assinada — o anexo herda o mesmo recorte do comunicado, sem
-- caminho paralelo por onde vazar.
create table if not exists comunicado_anexos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  comunicado_id bigint not null references comunicados(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf')),
  tamanho integer not null check (tamanho > 0 and tamanho <= 2097152),
  conteudo bytea not null
);

create index if not exists comunicado_anexos_idx on comunicado_anexos(comunicado_id);

alter table comunicado_anexos enable row level security;

-- O anexo é visível exatamente para quem enxerga o comunicado dele.
drop policy if exists comunicado_anexos_select on comunicado_anexos;
create policy comunicado_anexos_select on comunicado_anexos for select
  using (exists (select 1 from comunicados c where c.id = comunicado_id));

drop policy if exists comunicado_anexos_insert on comunicado_anexos;
create policy comunicado_anexos_insert on comunicado_anexos for insert
  with check (conta_id = conta_id() and exists (select 1 from comunicados c where c.id = comunicado_id));

drop policy if exists comunicado_anexos_delete on comunicado_anexos;
create policy comunicado_anexos_delete on comunicado_anexos for delete
  using (exists (select 1 from comunicados c where c.id = comunicado_id));

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
