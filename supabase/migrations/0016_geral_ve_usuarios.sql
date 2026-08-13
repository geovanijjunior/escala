-- Jornada — o Administrador Geral passa a ver os usuários das áreas.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ─────────────────────────────────────────────────────────────────
-- Nota sobre a mudança de postura
-- ─────────────────────────────────────────────────────────────────
-- A migration 0015 deu ao Administrador Geral o menor alcance possível: ele via
-- apenas os administradores locais, e mais nada. Essa restrição foi pedida de
-- volta — quem responde pelo sistema precisa saber quem tem acesso a ele.
--
-- O que muda e o que NÃO muda vale registrar, porque a diferença é o desenho:
--
--   passa a ver  — `perfis` de todas as áreas: nome, e-mail, papel, bloqueado.
--                  É a lista de quem tem login no sistema.
--   continua sem — `colaboradores` (matrícula, cargo, jornada, admissão),
--                  escalas, solicitações, ausências, ocorrências, comunicados.
--                  Dado de operação e de pessoa segue sendo da área.
--   continua sem — poder de alterar esses perfis. Ver não é gerir: `perfis_update`
--                  e `perfis_insert` seguem exatamente como a 0015 os deixou, e
--                  o Geral continua criando e bloqueando só `admin_local`.
--   continua sem — apagar área. Não há policy de delete em `contas`, e apagar
--                  levaria junto o histórico de meses fechados, que é registro
--                  trabalhista. Para tirar do ar existe `ativa`.
--
-- A leitura foi ampliada; a escrita, não. Um papel que enxerga muito e escreve
-- pouco é bem menos perigoso que o contrário.

-- ══════════════════════════════════════════════════════════════
-- Ver os usuários de todas as áreas
-- ══════════════════════════════════════════════════════════════
-- O ramo novo é `eh_admin_geral()` sozinho, sem o `and papel = 'admin_local'`
-- que a 0015 tinha. Os outros dois ramos ficam intactos: cada um continua
-- enxergando a própria linha e a própria área.
drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select
  using (
    id = auth.uid()
    or conta_id = conta_id()
    or eh_admin_geral()
  );

-- Não há função para listar os usuários de uma área: com a policy acima, o
-- Geral lê `perfis` direto, e um `select ... eq('conta_id', ...)` faz o recorte.
-- Uma função só para isso seria uma segunda porta para o mesmo dado.

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
