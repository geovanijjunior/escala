-- Escala — domínio: unidades, equipes, colaboradores, planos, gerações e
-- solicitações.
--
-- Toda tabela é isolada por conta_id. Além disso, o recorte por papel vale no
-- BANCO, não só na tela: gestor lê apenas colaboradores das equipes que
-- gerencia, colaborador lê apenas a própria linha, e a escala em rascunho é
-- invisível para o colaborador até ser publicada. Ver pode_ver_colaborador().

-- ========================= UNIDADES =========================
-- No protótipo as unidades eram duas constantes no código (MORUMBI/PAULISTA).
-- Aqui são dados da conta: dá pra ter 1, 2 ou N unidades sem tocar no motor.
create table unidades (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  sigla text not null,
  cor text not null default '#1A4E93',
  bg text not null default '#DCEAF8',
  capacidade_total int not null default 10 check (capacidade_total >= 0),
  capacidade_reservadas int not null default 0 check (capacidade_reservadas >= 0),
  ordem int not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (conta_id, codigo),
  check (capacidade_reservadas <= capacidade_total)
);
create index unidades_conta_id_idx on unidades(conta_id);

-- Capacidade excepcional: por dia da semana (0=dom..6=sáb) ou por data exata.
-- Precedência na leitura: data exata > dia da semana > capacidade padrão da unidade.
create table capacidades (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  unidade_id bigint not null references unidades(id) on delete cascade,
  dow int check (dow between 0 and 6),
  data date,
  total int not null check (total >= 0),
  reservadas int not null default 0 check (reservadas >= 0),
  check (num_nonnulls(dow, data) = 1),
  check (reservadas <= total)
);
create index capacidades_conta_id_idx on capacidades(conta_id);
create unique index capacidades_dow_uniq on capacidades(unidade_id, dow) where dow is not null;
create unique index capacidades_data_uniq on capacidades(unidade_id, data) where data is not null;

-- ========================= EQUIPES =========================
create table equipes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  regime text not null default '5x2' check (regime in ('12x36', '5x2')),
  turno text not null default 'D' check (turno in ('D', 'N')),
  gestor_id uuid references perfis(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (conta_id, codigo)
);
create index equipes_conta_id_idx on equipes(conta_id);

-- ========================= COLABORADORES =========================
-- perfil_id liga o colaborador a um usuário do sistema (opcional): sem ele a
-- pessoa entra na escala mas não faz login. É o que permite ao papel
-- "colaborador" enxergar exatamente a própria linha.
create table colaboradores (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  perfil_id uuid references perfis(id) on delete set null,
  nome text not null,
  matricula text not null,
  email text not null default '',
  cargo text not null default '',
  equipe_id bigint not null references equipes(id) on delete restrict,
  gestor_id uuid references perfis(id) on delete set null,
  regime text not null default '5x2' check (regime in ('12x36', '5x2')),
  turno text not null default 'D' check (turno in ('D', 'N')),
  ciclo text check (ciclo in ('IMPAR', 'PAR')),
  entrada text not null default '08:00',
  jornada numeric(4, 2) not null default 8 check (jornada > 0 and jornada <= 24),
  unidade_base_id bigint not null references unidades(id) on delete restrict,
  eleg_home boolean not null default true,
  eleg_externo boolean not null default false,
  sexta_reduzida boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo', 'afastado', 'desligado')),
  admissao date not null default current_date,
  desligamento date,
  criado_em timestamptz not null default now(),
  unique (conta_id, matricula),
  check (status <> 'desligado' or desligamento is not null),
  check (desligamento is null or desligamento >= admissao),
  check (regime <> '12x36' or ciclo is not null)
);
create index colaboradores_conta_id_idx on colaboradores(conta_id);
create index colaboradores_equipe_id_idx on colaboradores(equipe_id);
create unique index colaboradores_perfil_uniq on colaboradores(perfil_id) where perfil_id is not null;

-- ========================= FERIADOS =========================
create table feriados (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  data date not null,
  nome text not null,
  unique (conta_id, data)
);
create index feriados_conta_id_idx on feriados(conta_id);

-- ========================= AUSÊNCIAS =========================
-- Férias e demais ausências moram na mesma tabela e são ligadas ao COLABORADOR,
-- não ao plano do mês. No protótipo estavam dentro do plano mensal, então uma
-- ausência de 40 dias iniciada em julho sumia da escala de agosto — aqui o motor
-- lê qualquer ausência que intercepte o mês.
create table ausencias (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  tipo text not null check (tipo in ('FERIAS', 'AUSENCIA')),
  inicio date not null,
  dias int not null check (dias between 1 and 365),
  grupo text not null default '',
  motivo text not null default '',
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis(id) on delete set null,
  check (tipo = 'FERIAS' or (grupo <> '' and motivo <> ''))
);
create index ausencias_conta_id_idx on ausencias(conta_id);
create index ausencias_colaborador_idx on ausencias(colaborador_id, inicio);

-- ========================= PLANOS MENSAIS =========================
-- competencia é sempre o dia 1º do mês (o mês inteiro é a unidade de planejamento).
create table planos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  competencia date not null,
  ciclo text check (ciclo in ('IMPAR', 'PAR')),
  ho_modo text check (ho_modo in ('FIXO', 'COTA')),
  ho_dias_semana int[] not null default '{}',
  ho_quantidade int not null default 0 check (ho_quantidade between 0 and 7),
  ho_dias_preferencia int[] not null default '{}',
  ho_dias_proibidos int[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references perfis(id) on delete set null,
  unique (colaborador_id, competencia),
  check (date_part('day', competencia) = 1)
);
create index planos_conta_id_idx on planos(conta_id);
create index planos_competencia_idx on planos(conta_id, competencia);

-- Distribuição percentual do plano entre as unidades (deve somar 100).
create table plano_distribuicao (
  plano_id bigint not null references planos(id) on delete cascade,
  unidade_id bigint not null references unidades(id) on delete cascade,
  percentual int not null check (percentual between 0 and 100),
  primary key (plano_id, unidade_id)
);

-- Unidade travada para um dia da semana (ex.: toda terça na Paulista).
create table plano_unidade_fixa (
  plano_id bigint not null references planos(id) on delete cascade,
  dow int not null check (dow between 0 and 6),
  unidade_id bigint not null references unidades(id) on delete cascade,
  primary key (plano_id, dow)
);

-- ========================= GERAÇÕES =========================
create table geracoes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  competencia date not null,
  versao int not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicada', 'encerrada')),
  escopo text not null default 'Mês completo',
  conflitos jsonb not null default '[]',
  alertas jsonb not null default '[]',
  aderencia jsonb not null default '[]',
  atual boolean not null default true,
  gerada_em timestamptz not null default now(),
  gerada_por uuid references perfis(id) on delete set null,
  gerada_por_nome text not null default '',
  unique (conta_id, competencia, versao),
  check (date_part('day', competencia) = 1)
);
create index geracoes_conta_id_idx on geracoes(conta_id);
create unique index geracoes_atual_uniq on geracoes(conta_id, competencia) where atual;

-- Uma linha por (pessoa, dia). Normalizado — no protótipo era um objeto solto em
-- memória, com o id da unidade e o tipo de ausência misturados na mesma string.
create table alocacoes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  geracao_id bigint not null references geracoes(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  data date not null,
  modalidade text not null check (modalidade in
    ('UNIDADE', 'HOME', 'EXTERNO', 'EVENTO', 'TREINA', 'FERIAS', 'FOLGA', 'FERIADO', 'AFAST', 'DESCANSO')),
  unidade_id bigint references unidades(id) on delete set null,
  travado boolean not null default false,
  unique (geracao_id, colaborador_id, data),
  check (modalidade <> 'UNIDADE' or unidade_id is not null)
);
create index alocacoes_conta_id_idx on alocacoes(conta_id);
create index alocacoes_geracao_data_idx on alocacoes(geracao_id, data);
create index alocacoes_colaborador_idx on alocacoes(colaborador_id, data);

-- ========================= TRAVAS MANUAIS =========================
-- Ajuste manual que sobrevive a uma regeração: o motor lê a trava antes de
-- qualquer regra e a respeita como decisão já tomada.
create table pins (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  data date not null,
  modalidade text not null check (modalidade in
    ('UNIDADE', 'HOME', 'EXTERNO', 'EVENTO', 'TREINA', 'FERIAS', 'FOLGA', 'FERIADO', 'AFAST', 'DESCANSO')),
  unidade_id bigint references unidades(id) on delete cascade,
  motivo text not null default '',
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis(id) on delete set null,
  unique (colaborador_id, data),
  check (modalidade <> 'UNIDADE' or unidade_id is not null)
);
create index pins_conta_id_idx on pins(conta_id);

-- ========================= SOLICITAÇÕES =========================
create table solicitacoes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  tipo text not null check (tipo in
    ('AJUSTE_PONTO', 'BANCO_HORAS', 'FERIAS', 'FOLGA', 'ATRASO', 'PAUSA',
     'SAIDA_ANTEC', 'TROCA_HORARIO', 'TROCA_UNIDADE')),
  data date not null,
  detalhe text not null default '',
  parceiro_id bigint references colaboradores(id) on delete set null,
  aceite_parceiro text check (aceite_parceiro in ('PENDENTE', 'ACEITO', 'RECUSADO')),
  unidade_desejada_id bigint references unidades(id) on delete set null,
  status text not null default 'TRIAGEM' check (status in
    ('AGUARDA_PARCEIRO', 'TRIAGEM', 'GESTOR', 'FILA', 'APROVADA', 'RECUSADA')),
  posicao_fila int,
  motivo_recusa text,
  aplicada boolean not null default false,
  criado_em timestamptz not null default now(),
  check (tipo <> 'TROCA_HORARIO' or parceiro_id is not null),
  check (parceiro_id is null or parceiro_id <> colaborador_id)
);
create index solicitacoes_conta_id_idx on solicitacoes(conta_id);
create index solicitacoes_colaborador_idx on solicitacoes(colaborador_id);
create index solicitacoes_status_idx on solicitacoes(conta_id, status);

-- Trilha append-only de cada transição de estado.
create table solicitacao_eventos (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  solicitacao_id bigint not null references solicitacoes(id) on delete cascade,
  etapa text not null,
  detalhe text not null default '',
  por_id uuid references perfis(id) on delete set null,
  por_nome text not null default '',
  em timestamptz not null default now()
);
create index solic_eventos_solicitacao_idx on solicitacao_eventos(solicitacao_id);

-- ========================= OCORRÊNCIAS =========================
create table ocorrencias (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  colaborador_id bigint not null references colaboradores(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in
    ('ATRASO', 'FALTA_J', 'FALTA_I', 'SAIDA_ANTEC', 'PAUSA_EXC', 'SEM_MARCACAO', 'TROCA', 'OBS')),
  minutos int not null default 0 check (minutos >= 0),
  obs text not null default '',
  criado_em timestamptz not null default now(),
  registrado_por uuid references perfis(id) on delete set null
);
create index ocorrencias_conta_id_idx on ocorrencias(conta_id);
create index ocorrencias_colaborador_idx on ocorrencias(colaborador_id, data);

-- ========================= PARÂMETROS E AUDITORIA =========================
create table config (
  conta_id uuid primary key references contas(id) on delete cascade,
  -- Mês âncora do ciclo 12x36: a partir dele a paridade par/ímpar é derivada
  -- pelos dias decorridos, o que corrige sozinho a virada de mês de 31 dias.
  ciclo_ancora date not null default date_trunc('month', current_date)::date,
  tolerancia_aderencia int not null default 1 check (tolerancia_aderencia >= 0),
  cobertura_minima int not null default 1 check (cobertura_minima >= 0)
);

create table logs (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  usuario_id uuid references perfis(id) on delete set null,
  usuario_nome text not null default '',
  acao text not null,
  detalhe text not null default '',
  criado_em timestamptz not null default now()
);
create index logs_conta_id_idx on logs(conta_id, criado_em desc);

-- ========================= VISIBILIDADE POR PAPEL =========================
-- Um único predicado, usado por todas as policies que dependem de "de quem é
-- essa linha". Security definer pra não recursar na RLS da própria tabela.
create or replace function pode_ver_colaborador(p_colab bigint) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case papel()
    when 'planejamento' then exists (
      select 1 from colaboradores c where c.id = p_colab and c.conta_id = conta_id())
    when 'gestor' then exists (
      select 1 from colaboradores c
        join equipes e on e.id = c.equipe_id
      where c.id = p_colab and c.conta_id = conta_id()
        and (e.gestor_id = auth.uid() or c.gestor_id = auth.uid()))
    when 'colaborador' then exists (
      select 1 from colaboradores c
      where c.id = p_colab and c.conta_id = conta_id() and c.perfil_id = auth.uid())
    else false
  end
$$;

-- ========================= RLS =========================
alter table unidades enable row level security;
alter table capacidades enable row level security;
alter table equipes enable row level security;
alter table colaboradores enable row level security;
alter table feriados enable row level security;
alter table ausencias enable row level security;
alter table planos enable row level security;
alter table plano_distribuicao enable row level security;
alter table plano_unidade_fixa enable row level security;
alter table geracoes enable row level security;
alter table alocacoes enable row level security;
alter table pins enable row level security;
alter table solicitacoes enable row level security;
alter table solicitacao_eventos enable row level security;
alter table ocorrencias enable row level security;
alter table config enable row level security;
alter table logs enable row level security;

-- Referência compartilhada: quem tem qualquer papel no módulo lê; só o
-- Planejamento escreve.
create policy unidades_select on unidades for select
  using (conta_id = conta_id());
create policy unidades_write on unidades for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy capacidades_select on capacidades for select
  using (conta_id = conta_id());
create policy capacidades_write on capacidades for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy equipes_select on equipes for select
  using (conta_id = conta_id());
create policy equipes_write on equipes for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy feriados_select on feriados for select
  using (conta_id = conta_id());
create policy feriados_write on feriados for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy config_select on config for select
  using (conta_id = conta_id());
create policy config_write on config for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

-- Dados de pessoa: recorte por papel também na leitura.
create policy colaboradores_select on colaboradores for select
  using (conta_id = conta_id() and pode_ver_colaborador(id));
create policy colaboradores_write on colaboradores for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy ausencias_select on ausencias for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));
create policy ausencias_write on ausencias for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy planos_select on planos for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));
create policy planos_write on planos for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy plano_distribuicao_select on plano_distribuicao for select
  using (exists (select 1 from planos p
    where p.id = plano_id and p.conta_id = conta_id() and pode_ver_colaborador(p.colaborador_id)));
create policy plano_distribuicao_write on plano_distribuicao for all
  using (eh_planejamento() and exists (select 1 from planos p where p.id = plano_id and p.conta_id = conta_id()))
  with check (eh_planejamento() and exists (select 1 from planos p where p.id = plano_id and p.conta_id = conta_id()));

create policy plano_unidade_fixa_select on plano_unidade_fixa for select
  using (exists (select 1 from planos p
    where p.id = plano_id and p.conta_id = conta_id() and pode_ver_colaborador(p.colaborador_id)));
create policy plano_unidade_fixa_write on plano_unidade_fixa for all
  using (eh_planejamento() and exists (select 1 from planos p where p.id = plano_id and p.conta_id = conta_id()))
  with check (eh_planejamento() and exists (select 1 from planos p where p.id = plano_id and p.conta_id = conta_id()));

create policy pins_select on pins for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));
create policy pins_write on pins for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy ocorrencias_select on ocorrencias for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));
create policy ocorrencias_write on ocorrencias for all
  using (conta_id = conta_id() and papel() in ('planejamento', 'gestor')
         and pode_ver_colaborador(colaborador_id))
  with check (conta_id = conta_id() and papel() in ('planejamento', 'gestor')
         and pode_ver_colaborador(colaborador_id));

-- Geração: rascunho só aparece pro Planejamento. O colaborador só enxerga a
-- escala depois de publicada — no protótipo o rascunho vazava pra todo mundo.
create policy geracoes_select on geracoes for select
  using (conta_id = conta_id()
         and (status <> 'rascunho' or papel() in ('planejamento', 'gestor')));
create policy geracoes_write on geracoes for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

create policy alocacoes_select on alocacoes for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id)
         and exists (select 1 from geracoes g where g.id = geracao_id
                     and (g.status <> 'rascunho' or papel() in ('planejamento', 'gestor'))));
create policy alocacoes_write on alocacoes for all
  using (conta_id = conta_id() and eh_planejamento())
  with check (conta_id = conta_id() and eh_planejamento());

-- Solicitações: o colaborador vê as próprias e aquelas em que é o parceiro de troca.
create policy solicitacoes_select on solicitacoes for select
  using (conta_id = conta_id() and (
    pode_ver_colaborador(colaborador_id)
    or (parceiro_id is not null and pode_ver_colaborador(parceiro_id))));
create policy solicitacoes_insert on solicitacoes for insert
  with check (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));
-- O parceiro de troca precisa poder responder ao convite, mas só isso. Sem
-- congelar as colunas abaixo, ele conseguiria — batendo direto na API REST —
-- mudar a data do pedido, apontá-lo para outra pessoa ou saltar direto para
-- APROVADA, pulando triagem e gestor. Mesmo padrão de perfis_update_self (0007).
create policy solicitacoes_update on solicitacoes for update
  using (conta_id = conta_id() and (
    papel() in ('planejamento', 'gestor')
    or (parceiro_id is not null and pode_ver_colaborador(parceiro_id))))
  with check (conta_id = conta_id() and (
    papel() in ('planejamento', 'gestor')
    or (
      parceiro_id is not null
      and pode_ver_colaborador(parceiro_id)
      and status in ('TRIAGEM', 'RECUSADA')
      and aplicada = false
      and posicao_fila is null
      and colaborador_id = (select s.colaborador_id from solicitacoes s where s.id = solicitacoes.id)
      and parceiro_id = (select s.parceiro_id from solicitacoes s where s.id = solicitacoes.id)
      and tipo = (select s.tipo from solicitacoes s where s.id = solicitacoes.id)
      and data = (select s.data from solicitacoes s where s.id = solicitacoes.id)
    )));

create policy solic_eventos_select on solicitacao_eventos for select
  using (exists (select 1 from solicitacoes s where s.id = solicitacao_id and s.conta_id = conta_id()
    and (pode_ver_colaborador(s.colaborador_id)
         or (s.parceiro_id is not null and pode_ver_colaborador(s.parceiro_id)))));
create policy solic_eventos_insert on solicitacao_eventos for insert
  with check (conta_id = conta_id());

create policy logs_select on logs for select
  using (conta_id = conta_id() and papel() in ('planejamento', 'gestor'));
create policy logs_insert on logs for insert
  with check (conta_id = conta_id());
