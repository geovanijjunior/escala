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
alter table postos add column if not exists equipe_id bigint;

create index if not exists postos_equipe_idx on postos(equipe_id);

comment on column postos.equipe_id is
  'Equipe que cobre este posto. Nulo = qualquer equipe, que é como os postos existiam antes desta coluna.';

-- FK no padrão vigente: composta quando a 0009 já rodou, simples quando não.
--
-- A versão anterior desta migration declarava a FK composta direto, sem a
-- escolha. Numa instalação que nunca aplicou a 0009 — e que segue recebendo as
-- migrations seguintes, que é o caso que `manual_0008` existe para exercitar —
-- `equipes(id, conta_id)` não tem unicidade, e a migration inteira abortava em
-- "there is no unique constraint matching given keys".
--
-- E o `set null` precisa nomear a coluna. Sem a lista, apagar uma equipe
-- tentaria anular também o `conta_id` do posto, que é `not null`: a exclusão
-- falharia com um erro que não fala de equipe nenhuma. O que se quer é soltar o
-- posto da equipe e deixá-lo aberto a qualquer uma — que é o sentido do nulo.
--
-- O `drop` da FK de coluna única vem antes porque a versão com o defeito pode
-- já ter rodado: sem ele, o banco ficaria com as duas.
alter table postos drop constraint if exists postos_equipe_id_fkey;
alter table postos drop constraint if exists postos_equipe_conta_fk;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'equipes_id_conta_id_key') then
    alter table postos add constraint postos_equipe_conta_fk
      foreign key (equipe_id, conta_id) references equipes(id, conta_id) on delete set null (equipe_id);
  else
    alter table postos add constraint postos_equipe_conta_fk
      foreign key (equipe_id) references equipes(id) on delete set null;
  end if;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
