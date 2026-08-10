-- Escala — marca de leitura das notificações.
--
-- Não há tabela de notificações, de propósito. Toda mudança relevante já é
-- gravada em `solicitacao_eventos` com autor e horário, e a policy de leitura
-- dessa tabela já resolve o direcionamento sozinha:
--
--   · o colaborador enxerga os eventos dos próprios pedidos e das trocas em que
--     é parceiro;
--   · o gestor, os da equipe dele;
--   · o planejamento, os da conta inteira.
--
-- Ou seja, "para quem essa notificação é" já está respondido pelo banco.
-- Duplicar isso numa tabela de notificações criaria uma segunda fonte de
-- verdade que precisaria ser mantida em sincronia com a primeira.
--
-- Falta só o estado de leitura, que é por pessoa: um instante. Tudo que é mais
-- novo que ele, e não foi causado pela própria pessoa, está por ler.

alter table perfis
  add column if not exists notificacoes_vistas_em timestamptz not null default now();

-- A consulta do sino filtra por data e ordena por data decrescente.
create index if not exists solic_eventos_em_idx on solicitacao_eventos(em desc);

-- ── Endurecimento aproveitando a passagem ────────────────────────
-- perfis_update_self congelava papel e conta_id, mas deixava `bloqueado` e
-- `precisa_trocar_senha` graváveis pela própria pessoa. Hoje não é explorável:
-- o bloqueio real é o ban_duration do Auth, e quem está banido nem consegue
-- token para chamar a API. Mas são colunas de estado administrativo, e deixá-las
-- abertas convida a um bug no dia em que alguma tela passar a confiar nelas.
--
-- notificacoes_vistas_em segue gravável — é exatamente o que a pessoa precisa
-- atualizar ao ler o próprio sino.
drop policy if exists perfis_update_self on perfis;
create policy perfis_update_self on perfis for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel = (select p.papel from perfis p where p.id = auth.uid())
    and conta_id = (select p.conta_id from perfis p where p.id = auth.uid())
    and bloqueado = (select p.bloqueado from perfis p where p.id = auth.uid())
    and precisa_trocar_senha = (select p.precisa_trocar_senha from perfis p where p.id = auth.uid())
  );
