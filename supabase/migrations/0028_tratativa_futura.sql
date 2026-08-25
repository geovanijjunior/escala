-- Jornada — o pedido que não é para agora, mas também não é "não".
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- A terceira resposta da triagem
-- ══════════════════════════════════════════════════════════════
-- A triagem tinha duas saídas de verdade: encaminhar ao gestor ou recusar. A
-- lista de espera existia, mas é outra coisa — ela guarda ORDEM de chegada para
-- quando uma posição abrir, e por isso só vale nos tipos que disputam posição.
--
-- Faltava o caso mais comum de todos: o pedido legítimo, sem nada contra, que
-- simplesmente não se decide agora. Férias de um mês que ainda nem tem plano,
-- troca que depende de uma contratação, ajuste que espera a virada da folha.
-- Sem um lugar para ele, a triagem escolhia entre dois erros: recusar — que
-- apaga o pedido e obriga a pessoa a abrir outro quando a hora chegar — ou
-- deixar em TRIAGEM, entulhando a caixa de quem tria com o que ela já leu e
-- decidiu adiar. Na prática ficava em triagem, e o contador do menu virou um
-- número que ninguém mais olhava.
--
-- `TRATATIVA` é esse lugar. Não é decisão nem fila: é um pedido reconhecido e
-- estacionado, que sai de lá por aprovação ou recusa quando alguém retomar.
do $$
declare
  nome_check text;
begin
  select conname into nome_check
    from pg_constraint
   where conrelid = 'solicitacoes'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%'
     and pg_get_constraintdef(oid) like '%TRIAGEM%';

  if nome_check is null then
    raise notice 'CHECK de status não encontrado — nada a alterar';
    return;
  end if;

  if (select pg_get_constraintdef(oid) from pg_constraint where conname = nome_check)
     like '%TRATATIVA%' then
    raise notice 'TRATATIVA já consta no CHECK';
    return;
  end if;

  execute format('alter table solicitacoes drop constraint %I', nome_check);
  alter table solicitacoes add constraint solicitacoes_status_check
    check (status in (
      'AGUARDA_PARCEIRO', 'TRIAGEM', 'GESTOR', 'FILA', 'TRATATIVA', 'IMPLANTAR',
      'APROVADA', 'RECUSADA'
    ));
end $$;

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
