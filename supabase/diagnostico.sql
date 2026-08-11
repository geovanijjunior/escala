-- Quais migrations este banco já tem.
--
-- Cole no SQL Editor do Supabase e rode. Cada coluna olha um objeto que só
-- existe depois da migration correspondente — não há tabela de controle de
-- versão, então a pergunta é respondida pelo próprio esquema.
--
-- Só de leitura: não altera nada.

select
  case when to_regclass('public.postos') is not null
       then 'ok' else 'FALTA' end                                as "0005_postos",
  case when exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = 'equipes_gestor_idx')
       then 'ok' else 'FALTA' end                                as "0006_correcoes",
  case when exists (select 1 from information_schema.columns
                    where table_name = 'perfis' and column_name = 'notificacoes_vistas_em')
       then 'ok' else 'FALTA' end                                as "0007_notificacoes",
  case when exists (select 1 from information_schema.columns
                    where table_name = 'solicitacoes' and column_name = 'data_fim')
       then 'ok' else 'FALTA' end                                as "0008_periodo",
  case when exists (select 1 from pg_constraint
                    where conname = 'solicitacoes_colaborador_id_conta_fkey')
       then 'ok' else 'FALTA' end                                as "0009_vinculo";

-- Rode as que aparecerem como FALTA, em ordem numérica, do arquivo
-- correspondente em supabase/migrations/. Todas são idempotentes: rodar de novo
-- uma que já está aplicada não faz nada.
