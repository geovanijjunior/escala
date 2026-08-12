-- Escala — leitura por item no sino.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- Quais itens do sino cada pessoa já leu
-- ══════════════════════════════════════════════════════════════
-- Até aqui a leitura era um instante só: `perfis.notificacoes_vistas_em`. Isso
-- respondia "há algo novo?" com uma coluna e nenhuma tabela, o que era a
-- escolha certa enquanto o sino apenas contava.
--
-- Deixou de ser quando o sino passou a mostrar só o que falta ler: com um
-- carimbo único, abrir UM aviso marcava todos como lidos, e a lista inteira
-- desaparecia junto. Ler um recado não é ler os outros.
--
-- A chave é textual (`aviso-42`, `evento-7`) porque o sino junta duas fontes
-- com numeração própria. Uma FK para cada uma exigiria duas colunas anuláveis
-- e um CHECK garantindo que exatamente uma está preenchida — mais peça do que
-- benefício para uma tabela cuja perda de uma linha só faz um aviso reaparecer.
create table if not exists notificacoes_lidas (
  conta_id uuid not null references contas(id) on delete cascade,
  perfil_id uuid not null references perfis(id) on delete cascade,
  chave text not null,
  em timestamptz not null default now(),
  primary key (perfil_id, chave)
);

create index if not exists notificacoes_lidas_perfil_idx on notificacoes_lidas(perfil_id);

alter table notificacoes_lidas enable row level security;

-- A leitura de cada um é de cada um. Nem o Planejamento tem o que fazer aqui:
-- saber o que outra pessoa já leu não é informação de operação da escala.
drop policy if exists notificacoes_lidas_propria on notificacoes_lidas;
create policy notificacoes_lidas_propria on notificacoes_lidas for all
  using (conta_id = conta_id() and perfil_id = auth.uid())
  with check (conta_id = conta_id() and perfil_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- Última visita ao mural
-- ══════════════════════════════════════════════════════════════
-- Para o menu poder dizer quantos comunicados a pessoa ainda não viu. É um
-- carimbo, e não uma linha por comunicado lido, porque a pergunta do mural é
-- "chegou coisa nova desde que olhei?" — ninguém navega o mural item a item
-- como faz com o sino.
--
-- Coluna própria, e não `notificacoes_vistas_em`: o sino e o mural são duas
-- caixas separadas, e abrir uma não pode zerar a outra.
alter table perfis add column if not exists mural_visto_em timestamptz not null default '1970-01-01Z';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
