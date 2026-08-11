-- Escala — campos que faltavam para ocorrências detalhadas, opção de férias e
-- motivo de inativação do colaborador.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 1. Colaborador inativado precisa dizer por quê
-- ══════════════════════════════════════════════════════════════
-- `status` guardava só ativo/afastado/desligado. Sem o motivo, quem olha o
-- cadastro seis meses depois não sabe se a pessoa saiu, está de licença longa
-- ou foi emprestada a outra área — e a data de desligamento só faz sentido num
-- desses casos.
alter table colaboradores add column if not exists motivo_status text not null default '';

-- ══════════════════════════════════════════════════════════════
-- 2. Solicitação de férias: opção, abono e lançamento no Fiori
-- ══════════════════════════════════════════════════════════════
-- Férias no Brasil são parceladas em combinações fechadas (30 sem abono,
-- 20+10 de abono, 15+5+10…). Guardar só início e fim perde a informação de
-- qual combinação foi escolhida, que é o que o RH precisa para lançar.
alter table solicitacoes add column if not exists opcao_ferias text;
alter table solicitacoes add column if not exists lancado_fiori boolean;

-- Motivo da folga ou licença — a lista já existe no app (GRUPOS_AUSENCIA), o
-- banco só não tinha onde guardar a escolha.
alter table solicitacoes add column if not exists motivo text;

-- ══════════════════════════════════════════════════════════════
-- 3. Ocorrência: cada tipo pede um dado diferente
-- ══════════════════════════════════════════════════════════════
-- `minutos` servia para atraso e pausa. Falta pede quantos dias; saída
-- antecipada pede a hora em que a pessoa saiu (os minutos saem do cálculo
-- contra a jornada); troca pede com quem foi.
alter table ocorrencias add column if not exists dias integer not null default 1;
alter table ocorrencias add column if not exists hora_saida text;
alter table ocorrencias add column if not exists parceiro_id bigint;

-- A FK acompanha o padrão vigente no banco: composta quando a 0009 já rodou
-- (barra vínculo entre contas), simples quando ainda não. Assim a migration
-- funciona nos dois estados sem exigir ordem que já não seja a numérica.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ocorrencias_parceiro_fk') then
    if exists (select 1 from pg_constraint where conname = 'colaboradores_id_conta_id_key') then
      alter table ocorrencias add constraint ocorrencias_parceiro_fk
        foreign key (parceiro_id, conta_id) references colaboradores(id, conta_id)
        on delete set null (parceiro_id);
    else
      alter table ocorrencias add constraint ocorrencias_parceiro_fk
        foreign key (parceiro_id) references colaboradores(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists ocorrencias_parceiro_idx on ocorrencias(parceiro_id);

-- ══════════════════════════════════════════════════════════════
-- 4. Licenças viram um tipo de solicitação
-- ══════════════════════════════════════════════════════════════
-- Licença (nojo, gala, paternidade, maternidade, sem vencimento) era pedida
-- como "Folgas", o que misturava um dia de banco de horas com um afastamento
-- de semanas na mesma fila e no mesmo SLA.
alter table solicitacoes drop constraint if exists solicitacoes_tipo_check;
alter table solicitacoes add constraint solicitacoes_tipo_check check (tipo in (
  'AJUSTE_PONTO', 'BANCO_HORAS', 'FERIAS', 'FOLGA', 'LICENCA', 'ATRASO',
  'PAUSA', 'SAIDA_ANTEC', 'TROCA_HORARIO', 'TROCA_UNIDADE'
));

-- Licença cobre período, como férias e folga.
alter table solicitacoes drop constraint if exists solicitacoes_periodo_so_para_ausencia;
alter table solicitacoes add constraint solicitacoes_periodo_so_para_ausencia
  check (data_fim is null or tipo in ('FERIAS', 'FOLGA', 'LICENCA'));

-- ══════════════════════════════════════════════════════════════
-- 5. Troca de horário deixa de exigir o parceiro na abertura
-- ══════════════════════════════════════════════════════════════
-- Quem pede a troca nem sempre sabe com quem ela vai ser feita — é o
-- Planejamento que encontra o par ao encaixar na escala. Exigir o nome na
-- abertura obrigava a inventar um. O parceiro passa a ser registrado depois,
-- na ocorrência "Troca realizada". A coluna continua, para os pedidos antigos
-- e para quando o par já estiver combinado.
alter table solicitacoes drop constraint if exists solicitacoes_check;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
