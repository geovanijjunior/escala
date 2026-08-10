-- Escala — correções de auditoria: recorte por papel em plano_posto e índices
-- nas chaves estrangeiras.

-- ══════════════════════════════════════════════════════════════
-- 1. plano_posto vazava entre papéis
-- ══════════════════════════════════════════════════════════════
-- As irmãs plano_distribuicao e plano_unidade_fixa filtram por
-- pode_ver_colaborador(): o colaborador lê a própria linha, o gestor a da
-- equipe dele. plano_posto ficou só com `conta_id = conta_id()`, então
-- qualquer pessoa da conta lia, pela API REST, quem cobre qual posto e quando.
--
-- Não é dado crítico, mas quebra a invariante que o sistema sustenta em todo o
-- resto — o recorte por papel é do banco, não da tela — e uma exceção silenciosa
-- é exatamente o tipo de coisa que ninguém revisa depois.
drop policy if exists plano_posto_select on plano_posto;
create policy plano_posto_select on plano_posto for select
  using (exists (
    select 1 from planos p
    where p.id = plano_posto.plano_id
      and p.conta_id = conta_id()
      and pode_ver_colaborador(p.colaborador_id)
  ));

-- ══════════════════════════════════════════════════════════════
-- 2. Chaves estrangeiras sem índice
-- ══════════════════════════════════════════════════════════════
-- Postgres não indexa o lado filho de uma FK automaticamente. Sem índice, dois
-- caminhos ficam caros: o filtro por essa coluna e a verificação que o banco faz
-- ao apagar o pai (cascade e restrict varrem a tabela filha inteira).
--
-- Os que mais pesam aqui:
--   · solicitacoes.parceiro_id — consultado a CADA carregamento de página, pelo
--     contador de pendências do menu, e ainda dentro da policy de RLS.
--   · colaboradores.gestor_id e equipes.gestor_id — pode_ver_colaborador() os
--     usa em toda leitura feita por um gestor.
--   · alocacoes.unidade_id — a maior tabela do sistema (uma linha por pessoa por
--     dia) e a que responde "quem está no Morumbi no dia 12".

create index if not exists equipes_gestor_idx              on equipes(gestor_id);
create index if not exists colaboradores_gestor_idx        on colaboradores(gestor_id);
create index if not exists colaboradores_unidade_base_idx  on colaboradores(unidade_base_id);
create index if not exists ausencias_criado_por_idx        on ausencias(criado_por);
create index if not exists planos_atualizado_por_idx       on planos(atualizado_por);
create index if not exists plano_distribuicao_unidade_idx  on plano_distribuicao(unidade_id);
create index if not exists plano_unidade_fixa_unidade_idx  on plano_unidade_fixa(unidade_id);
create index if not exists geracoes_gerada_por_idx         on geracoes(gerada_por);
create index if not exists alocacoes_unidade_idx           on alocacoes(unidade_id);
create index if not exists pins_criado_por_idx             on pins(criado_por);
create index if not exists pins_unidade_idx                on pins(unidade_id);
create index if not exists solicitacoes_parceiro_idx       on solicitacoes(parceiro_id);
create index if not exists solicitacoes_unidade_desejada_idx on solicitacoes(unidade_desejada_id);
create index if not exists solic_eventos_conta_idx         on solicitacao_eventos(conta_id);
create index if not exists solic_eventos_por_idx           on solicitacao_eventos(por_id);
create index if not exists ocorrencias_registrado_por_idx  on ocorrencias(registrado_por);
create index if not exists logs_usuario_idx                on logs(usuario_id);
create index if not exists cotas_equipe_equipe_idx         on cotas_equipe(equipe_id);
create index if not exists plano_posto_conta_idx           on plano_posto(conta_id);
create index if not exists plano_posto_posto_idx           on plano_posto(posto_id);

-- Índice de trabalho, não de FK: o contador de pendências do menu roda em toda
-- página e filtra por (parceiro_id, status). O parcial mantém o índice pequeno,
-- já que só o status aberto é consultado.
create index if not exists solicitacoes_pendencia_parceiro_idx
  on solicitacoes(parceiro_id) where status = 'AGUARDA_PARCEIRO';
