-- Jornada — a cota por equipe vira mínimo, e o posto passa a ser de uma equipe.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 1. Cota de equipe: de teto a piso
-- ══════════════════════════════════════════════════════════════
-- `limite` nasceu como TETO — "no Morumbi cabem no máximo 5 técnicos". Na
-- operação a pergunta é a oposta: quantos daquela equipe PRECISAM estar ali
-- para o dia funcionar. Um teto não garante ninguém; um piso é o que impede a
-- unidade de abrir sem cobertura.
--
-- A coluna é renomeada, e não reinterpretada em silêncio: o número que estava
-- lá significava outra coisa, e deixar `limite` com sentido invertido faria
-- toda leitura futura do schema mentir. Os valores são preservados — quem
-- cadastrou "no máximo 5" passa a ler "no mínimo 5", que é uma decisão a
-- revisar na tela, não um dado a perder.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'cotas_equipe' and column_name = 'limite'
  ) and not exists (
    select 1 from information_schema.columns
     where table_name = 'cotas_equipe' and column_name = 'minimo'
  ) then
    alter table cotas_equipe rename column limite to minimo;
  end if;
end $$;

comment on column cotas_equipe.minimo is
  'Piso: quantas pessoas desta equipe o motor tenta garantir na unidade. Não é teto.';

-- ══════════════════════════════════════════════════════════════
-- 2. O posto pertence a uma equipe
-- ══════════════════════════════════════════════════════════════
-- O posto dizia onde a função é exercida, mas não quem a exerce — qualquer
-- pessoa de qualquer equipe podia ser marcada para o Corpo Clínico. Na prática
-- o posto é de um time: quem cobre enfermagem é da enfermagem.
--
-- Nulo continua valendo, e significa o que valia antes: posto aberto a
-- qualquer equipe. Sem isso, os postos já cadastrados virariam inválidos no
-- instante em que a coluna nascesse.
alter table postos add column if not exists equipe_id bigint references equipes(id) on delete set null;

create index if not exists postos_equipe_idx on postos(equipe_id);

comment on column postos.equipe_id is
  'Equipe que cobre este posto. Nulo = qualquer equipe, que é como os postos existiam antes desta coluna.';

-- O par (id, conta_id) é o que a 0009 usa para amarrar filho e pai na mesma
-- conta. Sem ele, um posto de uma área poderia apontar para a equipe de outra.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'postos'::regclass and conname = 'postos_equipe_conta_fk'
  ) then
    alter table postos
      add constraint postos_equipe_conta_fk
      foreign key (equipe_id, conta_id) references equipes(id, conta_id) on delete set null;
  end if;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
