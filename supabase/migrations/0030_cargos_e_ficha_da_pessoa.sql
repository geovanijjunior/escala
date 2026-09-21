-- Jornada — cargos deixam de ser lista fixa do sistema, e a ficha da pessoa
-- ganha CPF, nascimento e telefone.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- 1. CARGOS
-- ══════════════════════════════════════════════════════════════
-- `CARGOS` era um array de nove strings dentro de `constantes.ts`, e o
-- formulário do colaborador um `select` em cima dele. Isso funciona enquanto
-- toda área do mundo usar a mesma nomenclatura, o que não acontece: um hospital
-- tem Enfermeiro e Técnico de Enfermagem, uma operação de TI tem Analista Pl, e
-- nenhum dos dois quer ver a lista do outro. Quem quisesse um cargo novo
-- precisava de um deploy.
--
-- Os nove viram a semente de cada área, e não mais a lista definitiva: quem
-- cadastra acrescenta, renomeia e apaga o que não usa.
--
-- O QUE NÃO MUDA: `colaboradores.cargo` continua TEXTO, e não vira chave
-- estrangeira. A razão é o motor — `familiaDoCargo()` lê o prefixo do texto
-- ("Analista…" tem prioridade no home office, "Técnico…" na posição
-- presencial) — e a importação por planilha, que recebe cargo escrito à mão. Um
-- cargo apagado depois não apaga a ficha de ninguém; o que a lista controla é o
-- que se pode ESCOLHER de agora em diante.
create table if not exists cargos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  unique (conta_id, nome)
);
create index if not exists cargos_conta_id_idx on cargos(conta_id);

alter table cargos enable row level security;

-- Leitura para toda a área: o cargo aparece na grade, no painel do dia e na
-- tela do próprio colaborador. Escrita só para quem cadastra.
drop policy if exists cargos_select on cargos;
create policy cargos_select on cargos for select
  using (conta_id = conta_id());
drop policy if exists cargos_write on cargos;
create policy cargos_write on cargos for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

-- ── A semente, e o gatilho que a repete em área nova ──────────
--
-- Mesma forma dos feriados nacionais (0022): uma função `security definer` que
-- recebe a área, e um gatilho de `contas` que a chama. `on conflict do nothing`
-- para que rodar de novo não desfaça o que a área ajustou.
create or replace function semear_cargos_padrao(p_conta_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into cargos (conta_id, nome, ordem)
  select p_conta_id, nome, ordem
    from (values
      ('Técnico I', 1), ('Técnico II', 2), ('Técnico III', 3),
      ('Analista Jr', 4), ('Analista Pl', 5), ('Analista Sr', 6),
      ('Especialista', 7), ('Líder', 8), ('Aprendiz', 9)
    ) as padrao(nome, ordem)
  on conflict (conta_id, nome) do nothing;
$$;

revoke all on function semear_cargos_padrao(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function semear_cargos_padrao(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function semear_cargos_padrao(uuid) from anon;
  end if;
end $$;

comment on function semear_cargos_padrao(uuid) is
  'INTERNA: só o gatilho de área nova e a própria migration. Recebe a área por parâmetro e roda como definer.';

create or replace function cargos_da_conta_nova() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform semear_cargos_padrao(new.id);
  return new;
end;
$$;

drop trigger if exists contas_cargos on contas;
create trigger contas_cargos
  after insert on contas
  for each row execute function cargos_da_conta_nova();

-- E as áreas que já existem, que o gatilho não alcança.
do $$
declare a uuid;
begin
  for a in select id from contas loop
    perform semear_cargos_padrao(a);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 2. A FICHA DA PESSOA: CPF, NASCIMENTO E TELEFONE
-- ══════════════════════════════════════════════════════════════
-- Vão em `colaboradores`, e não em `perfis`, porque descrevem a PESSOA e não o
-- acesso. Quem entra por planilha não tem login nenhum e tem CPF do mesmo
-- jeito; e um dia o mesmo CPF pode receber um acesso que hoje não existe.
--
-- Texto, e não número: CPF tem zero à esquerda, e `numeric` o comeria. Só
-- dígitos, sem ponto nem traço — a máscara é assunto da tela, e guardar o
-- formatado faria "123.456.789-09" e "12345678909" conviverem como se fossem
-- CPFs diferentes.
alter table colaboradores
  add column if not exists cpf text not null default '',
  add column if not exists nascimento date,
  add column if not exists telefone text not null default '';

-- Vazio continua valendo: a operação já tem gente cadastrada sem esses dados, e
-- uma coluna obrigatória agora travaria toda edição de ficha antiga até alguém
-- sair atrás de onze dígitos que ninguém tem à mão.
alter table colaboradores drop constraint if exists colaboradores_cpf_formato;
alter table colaboradores add constraint colaboradores_cpf_formato
  check (cpf = '' or cpf ~ '^[0-9]{11}$');

alter table colaboradores drop constraint if exists colaboradores_telefone_formato;
alter table colaboradores add constraint colaboradores_telefone_formato
  check (telefone = '' or telefone ~ '^[0-9]{10,11}$');

-- Nascimento no passado, e de gente em idade de trabalhar. O teto de 120 anos
-- não é preciosismo: o erro real que ele pega é o ano digitado com dois dígitos
-- ou trocado (1899 em vez de 1989), que passaria calado e estragaria qualquer
-- relatório por idade.
alter table colaboradores drop constraint if exists colaboradores_nascimento_plausivel;
alter table colaboradores add constraint colaboradores_nascimento_plausivel
  check (
    nascimento is null
    or (nascimento < current_date and nascimento > current_date - interval '120 years')
  );

-- CPF não se repete DENTRO da área. O índice é parcial porque vazio não é
-- duplicata: sem o `where`, a segunda ficha sem CPF seria recusada como se
-- fosse a mesma pessoa.
create unique index if not exists colaboradores_cpf_unico
  on colaboradores (conta_id, cpf) where cpf <> '';

comment on column colaboradores.cpf is
  'Só dígitos, sem máscara. Vazio quando não informado; único dentro da área quando preenchido.';
comment on column colaboradores.telefone is
  'Só dígitos, com DDD. Opcional.';

notify pgrst, 'reload schema';
