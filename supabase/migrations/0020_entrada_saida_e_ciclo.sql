-- Jornada — o colaborador passa a ter horário de saída, e o ciclo 12x36 sai do
-- cadastro dele.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 1. Jornada em horas vira horário de saída
-- ══════════════════════════════════════════════════════════════
-- `jornada` guardava a duração (8h, 12h) e a saída era CALCULADA em quatro
-- telas diferentes, cada uma repetindo a mesma regra: entrada + jornada, mais
-- uma hora de intervalo quando passava de seis. Quem cadastra sabe a que horas
-- a pessoa entra e sai; a duração é que era derivada disso, e não o contrário.
--
-- A conversão preserva o dado: para cada colaborador, a saída é exatamente o
-- fim de turno que o sistema vinha exibindo. Nada muda na tela depois de rodar.
alter table colaboradores add column if not exists saida text;

update colaboradores
   set saida = to_char(
         entrada::time + (((jornada + case when jornada > 6 then 1 else 0 end))::text || ' hours')::interval,
         'HH24:MI')
 where saida is null
   and exists (
     select 1 from information_schema.columns
      where table_name = 'colaboradores' and column_name = 'jornada'
   );

-- Quem chegar sem jornada para converter (base nova) recebe o padrão.
update colaboradores set saida = '17:00' where saida is null;

alter table colaboradores alter column saida set default '17:00';
alter table colaboradores alter column saida set not null;

-- A duração deixa de ser guardada: com entrada e saída, ela é uma subtração.
alter table colaboradores drop column if exists jornada;

-- ══════════════════════════════════════════════════════════════
-- 2. O ciclo 12x36 é do mês, não do cadastro
-- ══════════════════════════════════════════════════════════════
-- Havia dois lugares dizendo em que paridade a pessoa entra: `colaboradores.ciclo`
-- e `planos.ciclo`. O do plano sempre venceu — o motor lê `plano?.ciclo` antes de
-- qualquer outra coisa — e a validação de plano já BLOQUEIA a geração de um 12x36
-- sem ciclo no mês. O campo do cadastro era, na prática, um valor que ninguém
-- consultava e que ainda assim precisava ser preenchido, por causa do CHECK
-- abaixo.
--
-- A coluna fica (é o histórico do que já foi cadastrado); o que sai é a
-- obrigatoriedade. O constraint é procurado pela definição porque nasceu sem
-- nome no `create table` da 0002, e o nome que o Postgres gerou não é estável
-- entre instalações.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'colaboradores'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%ciclo%'
       and pg_get_constraintdef(oid) ilike '%12x36%'
  loop
    execute format('alter table colaboradores drop constraint %I', c.conname);
  end loop;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
