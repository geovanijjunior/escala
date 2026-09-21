-- Jornada — o regime é da pessoa, e o turno ganha o vespertino.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- 1. O REGIME SAI DA EQUIPE
-- ══════════════════════════════════════════════════════════════
-- `equipes.regime` existia e GOVERNAVA a pessoa: ao cadastrar um colaborador,
-- `montarColaborador` copiava o regime da equipe escolhida, e o campo não
-- existia no formulário. Na prática a equipe decidia se alguém era 12x36 ou
-- 5x2, e ninguém podia discordar dela.
--
-- Isso não corresponde à operação. Um mesmo time costuma ter plantonista e
-- administrativo lado a lado — o plantão cobre o fim de semana, o 5x2 cobre o
-- horário comercial, e os dois respondem ao mesmo gestor. Com o regime na
-- equipe, a única saída era partir o time em dois só para o sistema aceitar,
-- o que depois se paga em cota, em escala e em aprovação.
--
-- A coluna some em vez de virar "sugestão": o mesmo dado em dois lugares
-- discorda um dia, e quando discordar ninguém vai saber qual dos dois é o
-- verdadeiro. `colaboradores.regime` já existe e passa a ser o único.
--
-- O que estava gravado não se perde: cada colaborador já carrega o próprio
-- regime, copiado da equipe no cadastro. Apagar a coluna da equipe não muda
-- nenhuma ficha.
alter table equipes drop column if exists regime;

-- ══════════════════════════════════════════════════════════════
-- 2. TURNO VESPERTINO
-- ══════════════════════════════════════════════════════════════
-- Eram dois valores, 'D' e 'N'. O vespertino não cabia em nenhum: quem entra
-- ao meio-dia e sai às nove da noite não é diurno nem noturno, e ia cadastrado
-- como diurno por falta de opção — o que faz a lista por turno mentir.
--
-- O turno é CLASSIFICAÇÃO, não regra: o motor não o lê em lugar nenhum, quem
-- define a jornada é `entrada` e `saida` da pessoa. Por isso acrescentar um
-- valor não mexe em escala já gerada.
alter table equipes drop constraint if exists equipes_turno_check;
alter table equipes add constraint equipes_turno_check
  check (turno in ('D', 'V', 'N'));

alter table colaboradores drop constraint if exists colaboradores_turno_check;
alter table colaboradores add constraint colaboradores_turno_check
  check (turno in ('D', 'V', 'N'));

comment on column colaboradores.turno is
  'D diurno, V vespertino, N noturno. Classificação para listas e filtros — a jornada de verdade está em entrada/saida.';
comment on column colaboradores.regime is
  'Único lugar onde o regime existe desde a 0031. A equipe não tem mais regime: um time pode ter plantonista e administrativo juntos.';

notify pgrst, 'reload schema';
