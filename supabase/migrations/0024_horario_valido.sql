-- Jornada — entrada e saída precisam ser horários que existem no relógio.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- Até a 0020 a duração do turno era `jornada numeric`, com
-- `check (jornada > 0 and jornada <= 24)`: o banco não deixava passar um
-- absurdo. Trocá-la por dois campos de texto tirou essa trava sem pôr nada no
-- lugar, e a validação que sobrou no app conferia só o FORMATO — `\d{2}:\d{2}`,
-- que "99:99" satisfaz.
--
-- O buraco não era teórico: uma sonda de `scripts/manual/hostil.mjs` trocou o
-- `type=time` do campo por `text` no inspetor, mandou "99:99" e o colaborador
-- foi gravado. Dali em diante ele apareceria como turno na tela e entraria na
-- conta de horas de uma ocorrência.
--
-- O app voltou a validar de verdade (`horaNormalizada`), e esta migration é a
-- segunda linha: uma Server Action nova, um script de carga ou um `update`
-- feito à mão no SQL Editor não passam por aquele código, mas passam por aqui.
--
-- `not valid` de propósito: a trava vale para toda escrita a partir de agora, e
-- não recusa a instalação que já tenha um horário torto guardado — o que faria
-- a migration abortar bem no banco que mais precisa dela. Para conferir o que
-- ficou para trás:
--
--   select id, nome, entrada, saida from colaboradores
--    where entrada !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
--       or saida   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
--
-- Depois de arrumar essas linhas, `alter table colaboradores validate
-- constraint colaboradores_horario_valido;` fecha o cerco também no passado.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'colaboradores'::regclass
       and conname = 'colaboradores_horario_valido'
  ) then
    alter table colaboradores
      add constraint colaboradores_horario_valido
      check (
        entrada ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and saida ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ) not valid;
  end if;
end $$;

comment on constraint colaboradores_horario_valido on colaboradores is
  'HH:MM de relógio real. Substitui o check numérico que a jornada em horas tinha antes da 0020.';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
