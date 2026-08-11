-- Escala — alterações de escala publicada que ainda não foram comunicadas.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ══════════════════════════════════════════════════════════════
-- Alterações pendentes de comunicação
-- ══════════════════════════════════════════════════════════════
-- Antes, mover alguém numa escala publicada disparava o aviso na hora. Isso
-- transformava uma reorganização de dez linhas em dez avisos para a mesma
-- pessoa, alguns deles descrevendo estados intermediários que nem duraram até
-- o fim do trabalho — e obrigava quem reorganiza a fazer tudo de uma vez, sem
-- poder parar no meio.
--
-- Agora a alteração é gravada aqui e a escala muda de imediato (quem opera vê
-- o resultado e os conflitos recalculados), mas o colaborador só é avisado
-- quando o Planejamento ou o gestor confirmar a publicação das alterações.
-- A linha é apagada nesse momento: esta tabela é uma caixa de saída, não um
-- histórico. O histórico é o log de auditoria, que continua registrando cada
-- movimento no instante em que acontece.
create table if not exists alteracoes_pendentes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references contas(id) on delete cascade,
  geracao_id bigint not null references geracoes(id) on delete cascade,
  colaborador_id bigint not null,
  data date not null,
  de text not null default '',
  para text not null default '',
  por_id uuid references perfis(id) on delete set null,
  por_nome text not null default '',
  criado_em timestamptz not null default now()
);

-- Uma linha por pessoa e dia: mover a mesma pessoa três vezes no mesmo dia é
-- uma alteração, não três. `de` fica com o valor original — o que o
-- colaborador tinha visto — e `para` é sobrescrito a cada movimento.
create unique index if not exists alteracoes_pendentes_unica
  on alteracoes_pendentes(geracao_id, colaborador_id, data);

create index if not exists alteracoes_pendentes_geracao_idx
  on alteracoes_pendentes(geracao_id);

-- FK no padrão vigente: composta quando a 0009 já rodou, simples quando não.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alteracoes_pendentes_colab_fk') then
    if exists (select 1 from pg_constraint where conname = 'colaboradores_id_conta_id_key') then
      alter table alteracoes_pendentes add constraint alteracoes_pendentes_colab_fk
        foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
    else
      alter table alteracoes_pendentes add constraint alteracoes_pendentes_colab_fk
        foreign key (colaborador_id) references colaboradores(id) on delete cascade;
    end if;
  end if;
end $$;

alter table alteracoes_pendentes enable row level security;

-- Quem enxerga a escala enxerga o que está para mudar nela. O recorte por
-- colaborador segue o mesmo helper das outras tabelas do domínio, para não
-- criar uma segunda definição de "quem vejo".
drop policy if exists alteracoes_pendentes_select on alteracoes_pendentes;
create policy alteracoes_pendentes_select on alteracoes_pendentes for select
  using (conta_id = conta_id() and pode_ver_colaborador(colaborador_id));

drop policy if exists alteracoes_pendentes_escreve on alteracoes_pendentes;
create policy alteracoes_pendentes_escreve on alteracoes_pendentes for all
  using (conta_id = conta_id() and papel() in ('planejamento', 'gestor'))
  with check (conta_id = conta_id() and papel() in ('planejamento', 'gestor'));

-- O cache de esquema do PostgREST não percebe DDL sozinho.
notify pgrst, 'reload schema';
