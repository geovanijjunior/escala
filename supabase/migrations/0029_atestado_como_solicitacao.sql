-- Jornada — afastamento por atestado médico vira um tipo de solicitação.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- O grupo existia; o caminho até ele, não
-- ══════════════════════════════════════════════════════════════
-- `GRUPOS_AUSENCIA` sempre teve o grupo Atestado, com três motivos — atestado
-- médico, consulta, acompanhamento familiar — e o Planejamento podia lançá-lo à
-- mão no plano do mês. O que nunca existiu foi o tipo de SOLICITAÇÃO
-- correspondente: quem apresenta um atestado não tinha como registrá-lo, e quem
-- recebia o papel na mão só podia lançar a ausência direto, sem pedido, sem
-- decisão de ninguém e sem histórico de quem aprovou o quê.
--
-- Na prática o atestado ia como "Licença", que é outra coisa: licença se
-- programa (paternidade, gala, nojo) e atestado chega depois do fato. Misturados,
-- o relatório de afastamentos não distinguia o previsível do imprevisível — que
-- é a única coisa que ele precisa distinguir.
--
-- Duas restrições precisam abrir: a lista de tipos e a que diz quais deles
-- podem cobrir um PERÍODO. Atestado de sete dias é um período, e sem a segunda
-- o pedido entraria com `data_fim` nulo, valendo um dia só.
do $$
declare
  nome_check text;
begin
  -- ── 1. O tipo ───────────────────────────────────────────────
  select conname into nome_check
    from pg_constraint
   where conrelid = 'solicitacoes'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%tipo%'
     and pg_get_constraintdef(oid) like '%AJUSTE_PONTO%';

  if nome_check is null then
    raise notice 'CHECK de tipo não encontrado — nada a alterar';
  elsif (select pg_get_constraintdef(oid) from pg_constraint where conname = nome_check)
        like '%ATESTADO%' then
    raise notice 'ATESTADO já consta no CHECK de tipo';
  else
    execute format('alter table solicitacoes drop constraint %I', nome_check);
    alter table solicitacoes add constraint solicitacoes_tipo_check
      check (tipo in (
        'AJUSTE_PONTO', 'BANCO_HORAS', 'FERIAS', 'FOLGA', 'LICENCA', 'ATESTADO',
        'ATRASO', 'PAUSA', 'SAIDA_ANTEC', 'TROCA_HORARIO', 'TROCA_UNIDADE'
      ));
  end if;

  -- ── 2. O direito a cobrir um período ────────────────────────
  select conname into nome_check
    from pg_constraint
   where conrelid = 'solicitacoes'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%data_fim%'
     and pg_get_constraintdef(oid) like '%LICENCA%';

  if nome_check is null then
    raise notice 'CHECK de período não encontrado — nada a alterar';
  elsif (select pg_get_constraintdef(oid) from pg_constraint where conname = nome_check)
        like '%ATESTADO%' then
    raise notice 'ATESTADO já pode cobrir período';
  else
    execute format('alter table solicitacoes drop constraint %I', nome_check);
    alter table solicitacoes add constraint solicitacoes_periodo_so_para_ausencia
      check (data_fim is null or tipo in ('FERIAS', 'FOLGA', 'LICENCA', 'ATESTADO'));
  end if;
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
