-- Jornada — o colaborador passa a enxergar a escala da própria equipe.
--
-- Idempotente: pode rodar de novo sem efeito.
--
-- ══════════════════════════════════════════════════════════════
-- Por quê
-- ══════════════════════════════════════════════════════════════
-- Até aqui o colaborador via a si mesmo e mais nada. Funciona para "onde eu
-- trabalho amanhã" e não para a pergunta que aparece logo depois: "quem está
-- comigo nesse plantão?". Sem isso, combinar uma troca exige perguntar no grupo
-- do WhatsApp qual colega está escalado — o sistema tem a resposta e a
-- escondia.
--
-- ══════════════════════════════════════════════════════════════
-- O recorte
-- ══════════════════════════════════════════════════════════════
-- A própria equipe, e só ela. Não é a área inteira: quem trabalha na
-- enfermagem não tem por que ler a escala do administrativo, e o salto de "eu"
-- para "todo mundo" seria grande demais para o que foi pedido.
--
-- Só colegas ATIVOS. A RLS é por LINHA, não por coluna: liberar a linha do
-- colega libera o cadastro dele inteiro — matrícula, cargo, admissão e o
-- motivo de inativação de quem saiu. `status = 'ativo'` é o que mantém o
-- motivo de desligamento fora do alcance, porque ele só existe em quem não
-- está ativo. A própria linha continua visível em qualquer situação: quem está
-- afastado precisa seguir vendo a própria escala.
--
-- A escala em RASCUNHO continua fechada. Quem gate isso é `alocacoes_select`,
-- que já compõe `pode_ver_colaborador` com o status da geração — esta migration
-- não toca nisso, e por isso o colaborador passa a ver a equipe apenas no que
-- já foi publicado. Um rascunho é hipótese, e hipótese vazando para a equipe
-- gera combinação de troca sobre uma escala que ainda vai mudar.
create or replace function pode_ver_colaborador(p_colab bigint)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case
    when papel() in ('planejamento', 'admin_local') then exists (
      select 1 from colaboradores c where c.id = p_colab and c.conta_id = conta_id())
    when papel() = 'gestor' then exists (
      select 1 from colaboradores c
        join equipes e on e.id = c.equipe_id
      where c.id = p_colab and c.conta_id = conta_id()
        and (e.gestor_id = auth.uid() or c.gestor_id = auth.uid()))
    when papel() = 'colaborador' then exists (
      select 1 from colaboradores eu
      where eu.conta_id = conta_id()
        and eu.perfil_id = auth.uid()
        and (
          -- Eu mesmo, em qualquer situação.
          eu.id = p_colab
          -- Ou um colega ativo da minha equipe.
          or exists (
            select 1 from colaboradores colega
            where colega.id = p_colab
              and colega.conta_id = conta_id()
              and colega.equipe_id = eu.equipe_id
              and colega.status = 'ativo'
          )
        ))
    else false
  end
$$;

comment on function pode_ver_colaborador(bigint) is
  'Recorte de quem cada papel enxerga. O colaborador vê a si mesmo e os colegas ATIVOS da própria equipe — a restrição a ativos existe porque a RLS libera a linha inteira, e o motivo de inativação não é assunto da equipe.';

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
