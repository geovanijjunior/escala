-- Jornada — a solicitação aberta pelo Planejamento volta a ele para implantar.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- O caminho que faltava
-- ══════════════════════════════════════════════════════════════
-- O fluxo nasceu de baixo para cima: o colaborador pede, a triagem do
-- Planejamento tria, o gestor decide. Funciona para o que o colaborador pede
-- por conta própria.
--
-- Falta o caminho inverso, que é o do dia a dia de quem opera: o Planejamento
-- abre o pedido PELA pessoa — férias combinadas na reunião, ausência
-- comunicada por telefone — e aí a triagem não faz sentido, porque quem triaria
-- é quem abriu. O que falta nesse caso é o oposto: depois de o gestor aprovar,
-- alguém precisa IMPLANTAR na escala e confirmar que está feito.
--
-- `IMPLANTAR` é esse estado. Não é decisão: a decisão já foi tomada pelo
-- gestor. É a etapa de execução, e ela existe separada porque aprovar e
-- implantar acontecem em momentos diferentes — o gestor aprova de onde estiver,
-- e a escala é mexida por quem senta na tela de montagem.
--
-- Sem esse estado, o pedido aberto pelo Planejamento pulava direto para
-- APROVADA na decisão do gestor, e nada distinguia "o gestor concordou" de "já
-- está na escala". A confirmação é o que fecha o ciclo para quem abriu.
do $$
declare
  nome_check text;
begin
  -- O CHECK nasceu sem nome no `create table`, então é procurado pela
  -- definição — o nome que o Postgres gerou não é estável entre instalações.
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
     like '%IMPLANTAR%' then
    raise notice 'IMPLANTAR já consta no CHECK';
    return;
  end if;

  execute format('alter table solicitacoes drop constraint %I', nome_check);
  alter table solicitacoes add constraint solicitacoes_status_check
    check (status in (
      'AGUARDA_PARCEIRO', 'TRIAGEM', 'GESTOR', 'FILA', 'IMPLANTAR', 'APROVADA', 'RECUSADA'
    ));
end $$;

-- Quem abriu. Um pedido aberto PELO Planejamento segue caminho diferente do que
-- o colaborador abre sozinho — pula a triagem na ida e ganha a implantação na
-- volta —, e sem registrar a origem não há como saber qual dos dois aplicar
-- quando o gestor decide.
--
-- O padrão é falso porque é o que descreve todo pedido que já existe: eles
-- vieram do fluxo antigo, em que só o colaborador abria.
alter table solicitacoes add column if not exists aberta_pelo_planejamento boolean not null default false;

comment on column solicitacoes.aberta_pelo_planejamento is
  'Pedido aberto pelo Planejamento em nome da pessoa: pula a triagem e, aprovado pelo gestor, volta para implantação.';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
