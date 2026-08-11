-- Escala — impedir vínculo entre contas no próprio banco.
--
-- Achado por uma bateria de integridade: nada impedia um colaborador da conta B
-- de apontar `equipe_id` para uma equipe da conta A. A RLS barra CRIAR linha em
-- outra conta, mas não olha para onde as chaves estrangeiras apontam, e os ids
-- são inteiros sequenciais — adivinhar um id da conta vizinha é trivial.
--
-- Não é hipotético: pode_ver_colaborador() navega colaborador → equipe → gestor.
-- Um vínculo cruzado faria um gestor de uma conta enxergar gente de outra, que é
-- exatamente a garantia que o sistema promete.
--
-- A correção é a forma canônica em multi-tenant: cada pai ganha uma unicidade
-- (id, conta_id) e cada filho passa a referenciar o PAR, não só o id. Assim o
-- banco recusa a linha cujo pai é de outra conta, sem depender de aplicação.
--
-- Colunas anuláveis seguem funcionando: com MATCH SIMPLE (padrão), a restrição
-- não é checada quando a coluna referenciada é nula.
--
-- Uma mudança de comportamento vem junto, achada pela mesma bateria:
-- alocacoes.unidade_id era ON DELETE SET NULL, mas existe um check dizendo que
-- modalidade 'UNIDADE' exige unidade preenchida. Apagar uma unidade já usada na
-- escala falhava com violação de check — mensagem opaca — em vez de recusa
-- clara. E anular seria errado de qualquer forma: a alocação é histórico ("no
-- dia 10/11 o Felipe estava no Morumbi"), não configuração. Agora é RESTRICT:
-- unidade com escala gerada não se apaga, se DESATIVA (o campo `ativa` existe
-- exatamente para isso).
--
-- Nas chaves com ON DELETE SET NULL a lista de colunas é obrigatória. Sem ela,
-- o Postgres anula TODAS as colunas da chave ao apagar o pai — inclusive
-- conta_id, que é NOT NULL, e apagar um posto passaria a falhar. A bateria de
-- integridade pegou isso na primeira execução. Exige Postgres 15 ou superior.

alter table colaboradores drop constraint if exists colaboradores_id_conta_id_key;
alter table colaboradores add constraint colaboradores_id_conta_id_key unique (id, conta_id);
alter table equipes drop constraint if exists equipes_id_conta_id_key;
alter table equipes add constraint equipes_id_conta_id_key unique (id, conta_id);
alter table geracoes drop constraint if exists geracoes_id_conta_id_key;
alter table geracoes add constraint geracoes_id_conta_id_key unique (id, conta_id);
alter table planos drop constraint if exists planos_id_conta_id_key;
alter table planos add constraint planos_id_conta_id_key unique (id, conta_id);
alter table postos drop constraint if exists postos_id_conta_id_key;
alter table postos add constraint postos_id_conta_id_key unique (id, conta_id);
alter table solicitacoes drop constraint if exists solicitacoes_id_conta_id_key;
alter table solicitacoes add constraint solicitacoes_id_conta_id_key unique (id, conta_id);
alter table unidades drop constraint if exists unidades_id_conta_id_key;
alter table unidades add constraint unidades_id_conta_id_key unique (id, conta_id);

alter table alocacoes drop constraint if exists alocacoes_colaborador_id_fkey;
alter table alocacoes drop constraint if exists alocacoes_colaborador_id_conta_fkey;
alter table alocacoes add constraint alocacoes_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table alocacoes drop constraint if exists alocacoes_geracao_id_fkey;
alter table alocacoes drop constraint if exists alocacoes_geracao_id_conta_fkey;
alter table alocacoes add constraint alocacoes_geracao_id_conta_fkey
  foreign key (geracao_id, conta_id) references geracoes(id, conta_id) on delete cascade;
alter table alocacoes drop constraint if exists alocacoes_posto_id_fkey;
alter table alocacoes drop constraint if exists alocacoes_posto_id_conta_fkey;
alter table alocacoes add constraint alocacoes_posto_id_conta_fkey
  foreign key (posto_id, conta_id) references postos(id, conta_id) on delete set null (posto_id);
alter table alocacoes drop constraint if exists alocacoes_unidade_id_fkey;
alter table alocacoes drop constraint if exists alocacoes_unidade_id_conta_fkey;
alter table alocacoes add constraint alocacoes_unidade_id_conta_fkey
  foreign key (unidade_id, conta_id) references unidades(id, conta_id) on delete restrict;
alter table ausencias drop constraint if exists ausencias_colaborador_id_fkey;
alter table ausencias drop constraint if exists ausencias_colaborador_id_conta_fkey;
alter table ausencias add constraint ausencias_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table capacidades drop constraint if exists capacidades_unidade_id_fkey;
alter table capacidades drop constraint if exists capacidades_unidade_id_conta_fkey;
alter table capacidades add constraint capacidades_unidade_id_conta_fkey
  foreign key (unidade_id, conta_id) references unidades(id, conta_id) on delete cascade;
alter table colaboradores drop constraint if exists colaboradores_equipe_id_fkey;
alter table colaboradores drop constraint if exists colaboradores_equipe_id_conta_fkey;
alter table colaboradores add constraint colaboradores_equipe_id_conta_fkey
  foreign key (equipe_id, conta_id) references equipes(id, conta_id) on delete restrict;
alter table colaboradores drop constraint if exists colaboradores_unidade_base_id_fkey;
alter table colaboradores drop constraint if exists colaboradores_unidade_base_id_conta_fkey;
alter table colaboradores add constraint colaboradores_unidade_base_id_conta_fkey
  foreign key (unidade_base_id, conta_id) references unidades(id, conta_id) on delete restrict;
alter table cotas_equipe drop constraint if exists cotas_equipe_equipe_id_fkey;
alter table cotas_equipe drop constraint if exists cotas_equipe_equipe_id_conta_fkey;
alter table cotas_equipe add constraint cotas_equipe_equipe_id_conta_fkey
  foreign key (equipe_id, conta_id) references equipes(id, conta_id) on delete cascade;
alter table cotas_equipe drop constraint if exists cotas_equipe_unidade_id_fkey;
alter table cotas_equipe drop constraint if exists cotas_equipe_unidade_id_conta_fkey;
alter table cotas_equipe add constraint cotas_equipe_unidade_id_conta_fkey
  foreign key (unidade_id, conta_id) references unidades(id, conta_id) on delete cascade;
alter table ocorrencias drop constraint if exists ocorrencias_colaborador_id_fkey;
alter table ocorrencias drop constraint if exists ocorrencias_colaborador_id_conta_fkey;
alter table ocorrencias add constraint ocorrencias_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table pins drop constraint if exists pins_colaborador_id_fkey;
alter table pins drop constraint if exists pins_colaborador_id_conta_fkey;
alter table pins add constraint pins_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table pins drop constraint if exists pins_unidade_id_fkey;
alter table pins drop constraint if exists pins_unidade_id_conta_fkey;
alter table pins add constraint pins_unidade_id_conta_fkey
  foreign key (unidade_id, conta_id) references unidades(id, conta_id) on delete cascade;
alter table plano_posto drop constraint if exists plano_posto_plano_id_fkey;
alter table plano_posto drop constraint if exists plano_posto_plano_id_conta_fkey;
alter table plano_posto add constraint plano_posto_plano_id_conta_fkey
  foreign key (plano_id, conta_id) references planos(id, conta_id) on delete cascade;
alter table plano_posto drop constraint if exists plano_posto_posto_id_fkey;
alter table plano_posto drop constraint if exists plano_posto_posto_id_conta_fkey;
alter table plano_posto add constraint plano_posto_posto_id_conta_fkey
  foreign key (posto_id, conta_id) references postos(id, conta_id) on delete cascade;
alter table planos drop constraint if exists planos_colaborador_id_fkey;
alter table planos drop constraint if exists planos_colaborador_id_conta_fkey;
alter table planos add constraint planos_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table postos drop constraint if exists postos_unidade_id_fkey;
alter table postos drop constraint if exists postos_unidade_id_conta_fkey;
alter table postos add constraint postos_unidade_id_conta_fkey
  foreign key (unidade_id, conta_id) references unidades(id, conta_id) on delete cascade;
alter table solicitacao_eventos drop constraint if exists solicitacao_eventos_solicitacao_id_fkey;
alter table solicitacao_eventos drop constraint if exists solicitacao_eventos_solicitacao_id_conta_fkey;
alter table solicitacao_eventos add constraint solicitacao_eventos_solicitacao_id_conta_fkey
  foreign key (solicitacao_id, conta_id) references solicitacoes(id, conta_id) on delete cascade;
alter table solicitacoes drop constraint if exists solicitacoes_colaborador_id_fkey;
alter table solicitacoes drop constraint if exists solicitacoes_colaborador_id_conta_fkey;
alter table solicitacoes add constraint solicitacoes_colaborador_id_conta_fkey
  foreign key (colaborador_id, conta_id) references colaboradores(id, conta_id) on delete cascade;
alter table solicitacoes drop constraint if exists solicitacoes_parceiro_id_fkey;
alter table solicitacoes drop constraint if exists solicitacoes_parceiro_id_conta_fkey;
alter table solicitacoes add constraint solicitacoes_parceiro_id_conta_fkey
  foreign key (parceiro_id, conta_id) references colaboradores(id, conta_id) on delete set null (parceiro_id);
alter table solicitacoes drop constraint if exists solicitacoes_unidade_desejada_id_fkey;
alter table solicitacoes drop constraint if exists solicitacoes_unidade_desejada_id_conta_fkey;
alter table solicitacoes add constraint solicitacoes_unidade_desejada_id_conta_fkey
  foreign key (unidade_desejada_id, conta_id) references unidades(id, conta_id) on delete set null (unidade_desejada_id);

