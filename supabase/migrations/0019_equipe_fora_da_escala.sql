-- Jornada — equipes que não entram na escala.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- Nem toda equipe da organização é escalada. Há times que usam o Jornada só
-- pelo fluxo de solicitações — pedem férias, folga e licença, e o gestor
-- aprova — mas cujo trabalho não é distribuído entre unidades por dia. Até
-- aqui não havia como dizer isso: cadastrada a equipe, os colaboradores dela
-- entravam na geração e passavam a disputar posição com quem depende dela.
--
-- O efeito é justamente esse: quem está numa equipe fora da escala não é
-- alocado, e portanto NÃO OCUPA POSIÇÃO em unidade nenhuma. A capacidade do
-- prédio volta a valer só para quem de fato precisa estar lá.
--
-- `default true` porque toda equipe que já existe está na escala — a coluna
-- nasce sem mudar o comportamento de nenhuma instalação.
alter table equipes add column if not exists na_escala boolean not null default true;

comment on column equipes.na_escala is
  'Falso para equipes que só usam solicitações: seus colaboradores não entram na geração nem ocupam posição.';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
