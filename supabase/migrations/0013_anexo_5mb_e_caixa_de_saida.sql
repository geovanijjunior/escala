-- Escala — teto de anexo em 5 MB e correção do recorte da caixa de saída.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- 1. Anexo do mural vai a 5 MB
-- ══════════════════════════════════════════════════════════════
-- 2 MB cobria foto de aviso e PDF de duas páginas, mas não o PDF escaneado de
-- uma circular assinada, que é justamente o que mais se anexa. O conteúdo
-- continua em `bytea` — ver o comentário da 0011 —, e o teto continua existindo
-- porque é ele que mantém essa escolha honesta.
alter table comunicado_anexos drop constraint if exists comunicado_anexos_tamanho_check;
alter table comunicado_anexos add constraint comunicado_anexos_tamanho_check
  check (tamanho > 0 and tamanho <= 5242880);

-- ══════════════════════════════════════════════════════════════
-- 2. A caixa de saída não é visível para quem ela ainda não avisou
-- ══════════════════════════════════════════════════════════════
-- A policy da 0012 usava `pode_ver_colaborador(colaborador_id)`, que é o
-- recorte certo para quase todo o domínio e o errado para esta tabela: o
-- colaborador se enxerga, então ele lia a alteração que ainda não lhe tinha
-- sido comunicada. Nenhuma tela expunha isso hoje, o que é exatamente o que
-- torna o caso perigoso — a brecha esperaria a primeira tela que lesse a
-- tabela para virar vazamento.
--
-- Esta tabela é a caixa de saída de quem edita a escala. Quem lê é quem edita:
-- Planejamento, e o gestor dentro do recorte dele.
drop policy if exists alteracoes_pendentes_select on alteracoes_pendentes;
create policy alteracoes_pendentes_select on alteracoes_pendentes for select
  using (
    conta_id = conta_id()
    and papel() in ('planejamento', 'gestor')
    and pode_ver_colaborador(colaborador_id)
  );

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
