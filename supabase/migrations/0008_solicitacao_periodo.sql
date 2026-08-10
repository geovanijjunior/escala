-- Escala — solicitações que cobrem um período, não um dia.
--
-- `data` sempre foi um dia só. Serve para ajuste de ponto, troca de plantão ou
-- uma folga avulsa, mas não para férias: ninguém tira férias de 10/11 pedindo um
-- dia. Na prática a aprovação de férias criava uma ausência de 1 dia e o resto
-- do período simplesmente não existia na escala.
--
-- `data_fim` é opcional. Nulo significa "só o dia de `data`", que é o
-- comportamento de todos os tipos que continuam sendo pontuais — nada precisa
-- ser migrado.

alter table solicitacoes
  add column if not exists data_fim date;

alter table solicitacoes
  drop constraint if exists solicitacoes_periodo_valido,
  add constraint solicitacoes_periodo_valido
  check (data_fim is null or data_fim >= data);

-- Férias e folga são os tipos que aceitam período. Os demais permanecem
-- pontuais, e deixar isso no banco evita que uma tela nova invente um intervalo
-- de "ajuste de ponto", que não significaria nada.
alter table solicitacoes
  drop constraint if exists solicitacoes_periodo_so_para_ausencia,
  add constraint solicitacoes_periodo_so_para_ausencia
  check (data_fim is null or tipo in ('FERIAS', 'FOLGA'));

comment on column solicitacoes.data_fim is
  'Fim do período, quando o tipo cobre mais de um dia (férias, folga longa). Nulo = pedido de um dia só.';
