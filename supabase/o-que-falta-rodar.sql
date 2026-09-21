-- =====================================================================
-- O QUE FALTA RODAR — Jornada
-- =====================================================================
--
-- SÓ LEITURA. Não cria, não altera e não apaga nada: dá para rodar na base
-- de produção, no meio do expediente, sem combinar com ninguém.
--
-- Como rodar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
--
-- COMO ELE SABE
--   O projeto não tem tabela de controle de migrations — elas são coladas
--   à mão no SQL Editor, e o banco não guarda memória de quais já passaram.
--   Então a conferência é pelo RESULTADO: cada linha abaixo procura o que
--   aquela migration deixa para trás (uma coluna, uma função, um gatilho,
--   um valor dentro de um CHECK) e responde se está lá.
--
--   Isso é mais confiável que um registro de execução, que diz o que alguém
--   mandou rodar e não o que de fato ficou de pé. Uma migration interrompida
--   no meio apareceria como aplicada num controle por registro; aqui ela
--   aparece pelo que falta.
--
--   O reverso também vale, e é a limitação honesta desta abordagem: se
--   alguém criou a coluna à mão sem rodar a migration, isto aqui diz
--   "aplicada". O que ele garante é o ESTADO do banco, não a história dele.
--
-- COMO LER
--   Rode as que aparecerem como FALTA na ORDEM DO NÚMERO, uma de cada vez.
--   Elas se apoiam umas nas outras: a 0029 mexe num CHECK que a 0008 criou.
--   Pular uma do meio costuma dar erro de objeto inexistente, que parece
--   defeito da migration e é só ordem trocada.
-- =====================================================================

with verificacoes as (
  select * from (values

  -- ── Fundação ──────────────────────────────────────────────────────
  ('0001', 'init: contas, perfis e o papel de cada um',
   to_regclass('public.perfis') is not null),

  ('0002', 'escalas: colaboradores, unidades, equipes, planos, geração',
   to_regclass('public.colaboradores') is not null),

  ('0003', 'cota por equipe na unidade',
   to_regclass('public.cotas_equipe') is not null),

  -- A 0004 é o único caso de migration DESFEITA por outra: a 0005 apaga o
  -- gatilho, a função e a coluna `pai_id` que ela criou — subunidade foi
  -- tentada e abandonada. Logo, numa base em dia ela não deixa rastro
  -- nenhum, e procurar o rastro dela acusaria falta numa base completa.
  -- A pergunta certa não é "a 0004 passou?" e sim "preciso rodá-la?", e a
  -- resposta é não assim que a 0005 tiver passado.
  ('0004', 'subunidades — desfeita pela 0005; nada a rodar depois dela',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'unidades'
              and column_name = 'pai_id')
   or to_regclass('public.postos') is not null),

  ('0005', 'postos de trabalho',
   to_regclass('public.postos') is not null),

  ('0006', 'correções: índices de gestor e política do plano_posto',
   to_regclass('public.colaboradores_gestor_idx') is not null),

  ('0007', 'notificações: índice do evento e update do próprio perfil',
   to_regclass('public.solic_eventos_em_idx') is not null),

  ('0008', 'solicitação com período (data_fim)',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'solicitacoes'
              and column_name = 'data_fim')),

  ('0009', 'vínculo por conta: chaves estrangeiras compostas',
   exists (select 1 from pg_constraint
            where conname = 'alocacoes_colaborador_id_conta_fkey')),

  ('0010', 'ocorrências e férias (motivo_status, opção de férias, Fiori)',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'colaboradores'
              and column_name = 'motivo_status')),

  ('0011', 'mural de comunicados e avisos',
   to_regclass('public.avisos') is not null),

  ('0012', 'alterações pendentes (caixa de saída da escala publicada)',
   to_regclass('public.alteracoes_pendentes') is not null),

  -- A 0013 e a 0017 mexem no MESMO check de tamanho de anexo, então a 0017
  -- apaga o rastro da 0013. Aqui a 0013 é dada por aplicada quando o teto é
  -- pelo menos o dela — que é o que importa: nunca vai ser preciso rodá-la
  -- depois da 0017.
  ('0013', 'anexo de 5 MB e caixa de saída  (substituída pela 0017)',
   exists (select 1 from pg_constraint
            where conname = 'comunicado_anexos_tamanho_check'
              and (pg_get_constraintdef(oid) like '%5242880%'
                or pg_get_constraintdef(oid) like '%20971520%'))),

  ('0014', 'notificações lidas e mural visto',
   to_regclass('public.notificacoes_lidas') is not null),

  ('0015', 'áreas e administradores (papéis novos, conta ativa)',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'contas'
              and column_name = 'ativa')),

  ('0016', 'administrador geral enxerga os usuários',
   exists (select 1 from pg_policies
            where schemaname = 'public' and tablename = 'perfis'
              and policyname = 'perfis_select')),

  ('0017', 'anexo do mural vai a 20 MB',
   exists (select 1 from pg_constraint
            where conname = 'comunicado_anexos_tamanho_check'
              and pg_get_constraintdef(oid) like '%20971520%')),

  ('0018', 'código de unidade e de equipe gerado pelo banco',
   exists (select 1 from pg_trigger
            where tgname = 'unidades_codigo' and not tgisinternal)),

  ('0019', 'equipe fora da escala',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'equipes'
              and column_name = 'na_escala')),

  ('0020', 'entrada e saída no lugar da jornada',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'colaboradores'
              and column_name = 'saida')),

  ('0021', 'cota vira piso (minimo) e posto ganha equipe',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'cotas_equipe'
              and column_name = 'minimo')),

  ('0022', 'feriados nacionais calculados (Páscoa e derivados)',
   exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'pascoa')),

  -- A 0023 fecha a semeadura: a versão que recebe a área por parâmetro deixa
  -- de ser chamável por quem está logado, e nasce uma de um argumento só.
  -- É a existência DESSA que separa as duas.
  ('0023', 'semeadura de feriados fechada ao usuário logado',
   exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'semear_feriados_nacionais'
              and p.pronargs = 1)),

  ('0024', 'horário de entrada e saída validado pelo banco',
   exists (select 1 from pg_constraint where conname = 'colaboradores_horario_valido')),

  -- A 0025 não muda o esquema: corrige DADO. A assinatura do erro que ela
  -- conserta é um 12x36 medindo exatamente treze horas, então é isso que se
  -- procura. Numa base sem nenhum 12x36 ela aparece como aplicada porque
  -- não há mesmo nada a corrigir — o que é a resposta certa para
  -- "preciso rodar isto?".
  ('0025', 'plantão 12x36 volta a durar doze horas  (corrige dado, não esquema)',
   not exists (
     select 1 from colaboradores
      where regime = '12x36'
        and ((extract(epoch from saida::time) - extract(epoch from entrada::time))::int / 60 + 1440) % 1440 = 780
   )),

  -- ── As quatro recentes ────────────────────────────────────────────
  -- Aqui não basta a função existir: `pode_ver_colaborador` nasceu na 0002, e
  -- a 0026 só TROCA O CORPO dela. Procurar o nome diria "aplicada" numa base
  -- que parou na 0025 — foi o que aconteceu no primeiro teste deste script.
  -- O que só a versão nova tem é o segundo `colaboradores`, apelidado
  -- `colega`: é ele que lê o time de quem está perguntando.
  ('0026', 'colaborador enxerga os colegas da própria equipe',
   exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'pode_ver_colaborador'
              and pg_get_functiondef(p.oid) like '%colaboradores colega%')),

  ('0027', 'Planejamento abre solicitação e implanta o que aprovou',
   exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'solicitacoes'
              and column_name = 'aberta_pelo_planejamento')),

  ('0028', 'status TRATATIVA (tratativa futura) na triagem',
   exists (select 1 from pg_constraint
            where conrelid = 'public.solicitacoes'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) like '%TRATATIVA%')),

  ('0029', 'atestado médico vira tipo de solicitação',
   exists (select 1 from pg_constraint
            where conrelid = 'public.solicitacoes'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) like '%ATESTADO%'))

  ) as v(numero, o_que_faz, aplicada)
)

-- ── O relatório ───────────────────────────────────────────────────────
select
  case when aplicada then '  ok  ' else '▶ FALTA' end as situacao,
  numero,
  o_que_faz
from verificacoes
order by numero;
