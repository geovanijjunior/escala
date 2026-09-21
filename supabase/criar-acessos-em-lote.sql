-- =====================================================================
-- CRIAR ACESSOS EM LOTE — direto no banco
-- =====================================================================
--
-- Cria o login de todo colaborador ATIVO que ainda não tem, com uma senha
-- diferente para cada um, e devolve a lista de senhas para distribuir.
--
-- Como rodar: Supabase → SQL Editor. A PARTE 1 é só leitura — rode ela
-- primeiro e confira o número. As partes 2 a 4 escrevem.
--
-- ── ANTES DE COMEÇAR, TRÊS COISAS ────────────────────────────────────
--
-- 1. ISTO ESCREVE EM `auth.users`, que é território do GoTrue — o serviço de
--    autenticação do Supabase. A forma suportada de criar usuário é a API de
--    admin, que é o que a tela "Dar acesso a quem já está na escala" usa. O
--    esquema de `auth` pode mudar numa atualização do Supabase sem aviso, e
--    quando mudar este script para de funcionar. Ele existe como atalho de
--    implantação, não como o caminho de todo dia.
--
-- 2. A PARTE 3 IMPRIME SENHAS EM CLARO. Copie, distribua e rode a PARTE 4,
--    que apaga a lista do banco. Enquanto ela existir, é uma tabela com as
--    senhas de todo mundo — por isso ela nasce num schema fora do `public`,
--    que a API REST não expõe.
--
-- 3. A TROCA NO PRIMEIRO ACESSO AINDA NÃO É FORÇADA. O campo
--    `precisa_trocar_senha` é gravado, e o sistema hoje só o registra: não há
--    tela que obrigue a troca. Eu afirmei o contrário antes, e estava errado.
--    Até isso existir, trate estas senhas como permanentes — peça a troca por
--    fora, ou me peça para implementar a trava.
--
-- ── O QUE ELE FAZ E O QUE NÃO FAZ ────────────────────────────────────
--
-- Entra no lote quem está ATIVO, tem e-mail em formato válido e ainda não tem
-- login. Fica de fora, em silêncio e de propósito:
--
--   · quem está afastado ou desligado — é justamente quem não se quer liberar;
--   · quem já tem login, inclusive com e-mail cadastrado em outra área;
--   · o segundo de dois colaboradores que dividem o mesmo e-mail (um e-mail é
--     um login; passa o de menor id e o outro fica para tratar à mão).
--
-- Rodar duas vezes é seguro: a segunda passada não encontra ninguém, porque
-- quem foi criado deixou de ter `perfil_id` nulo.
-- =====================================================================

set search_path = public, extensions;


-- ── PARTE 1 — CONFERIR  (só leitura, não muda nada) ──────────────────
--
-- Rode sozinha primeiro. O número tem de bater com o que você espera.

select
  ct.nome                                              as area,
  count(*)                                             as vao_receber_acesso,
  min(c.nome)                                          as primeiro_da_lista,
  max(c.nome)                                          as ultimo_da_lista
from colaboradores c
join contas ct on ct.id = c.conta_id
where c.perfil_id is null
  and c.status = 'ativo'
  and coalesce(trim(c.email), '') <> ''
  and trim(c.email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  and not exists (select 1 from auth.users u where lower(u.email) = lower(trim(c.email)))
group by ct.nome
order by ct.nome;

-- E quem NÃO vai entrar, com o motivo. Vale a olhada: é aqui que aparece o
-- e-mail digitado errado que passaria despercebido.
select
  c.nome,
  c.matricula,
  coalesce(nullif(trim(c.email), ''), '—') as email,
  case
    when coalesce(trim(c.email), '') = '' then 'sem e-mail na ficha'
    when trim(c.email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'e-mail em formato inválido'
    when exists (select 1 from auth.users u where lower(u.email) = lower(trim(c.email))) then 'esse e-mail já é um login'
  end as por_que_fica_de_fora
from colaboradores c
where c.perfil_id is null
  and c.status = 'ativo'
  and (coalesce(trim(c.email), '') = ''
    or trim(c.email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or exists (select 1 from auth.users u where lower(u.email) = lower(trim(c.email))))
order by c.nome;


-- ── PARTE 2 — CRIAR ──────────────────────────────────────────────────

create schema if not exists lote_temp;

-- A senha. `gen_random_bytes` do pgcrypto, e não `random()`: isto é
-- credencial, e `random()` é previsível a partir de saídas anteriores — num
-- lote de oitenta, quem recebesse a própria senha teria material para as
-- outras. O alfabeto exclui O/0 e I/l/1, que viram chamado de suporte quando
-- a senha é ditada por telefone. O byte acima de 216 é descartado em vez de
-- reduzido por `%`: 256 não é múltiplo de 54, e sem a rejeição as quarenta
-- primeiras letras sairiam com mais frequência que as outras.
create or replace function lote_temp.senha(tamanho int default 12) returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  n int := 54;
  teto int := 216;   -- (256 / 54) * 54
  saida text := '';
  b int;
begin
  while length(saida) < tamanho loop
    b := get_byte(gen_random_bytes(1), 0);
    if b < teto then
      saida := saida || substr(alfabeto, (b % n) + 1, 1);
    end if;
  end loop;
  return saida;
end;
$$;

-- A fila: quem entra, com o id do usuário e a senha já sorteados. Fixar os
-- dois aqui é o que permite gravar em três tabelas diferentes sabendo de
-- antemão qual id vai para onde.
drop table if exists lote_temp.fila;
create table lote_temp.fila as
select
  c.id                                  as colaborador_id,
  c.conta_id,
  c.nome,
  c.matricula,
  lower(trim(c.email))                  as email,
  gen_random_uuid()                     as usuario_id,
  lote_temp.senha(12)                   as senha
from colaboradores c
where c.perfil_id is null
  and c.status = 'ativo'
  and coalesce(trim(c.email), '') <> ''
  and trim(c.email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  and not exists (select 1 from auth.users u where lower(u.email) = lower(trim(c.email)))
  -- Um e-mail, um login: de dois que dividem o mesmo endereço, passa o de
  -- menor id. O outro sobra para ser tratado à mão, que é o certo — não dá
  -- para adivinhar qual dos dois é o dono do endereço.
  and c.id = (
    select min(c2.id) from colaboradores c2
     where lower(trim(c2.email)) = lower(trim(c.email))
       and c2.perfil_id is null and c2.status = 'ativo'
  );

-- 1. O usuário do Auth. A senha vai com bcrypt, que é o que o GoTrue confere
--    no login; `email_confirmed_at` preenchido é o que dispensa o e-mail de
--    confirmação. Os metadados são lidos pelo gatilho `on_auth_user_created`,
--    que cria o perfil na área certa — é por isso que `conta_id` vai aqui.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  f.usuario_id,
  'authenticated',
  'authenticated',
  f.email,
  crypt(f.senha, gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'nome', f.nome,
    'papel', 'colaborador',
    'conta_id', f.conta_id,
    'precisa_trocar_senha', true
  ),
  now(), now()
from lote_temp.fila f;

-- 2. As colunas de texto que o GoTrue lê como string e não aceita nulas.
--    Um nulo aqui não quebra a gravação: quebra o LOGIN, com um erro obscuro
--    ("converting NULL to string is unsupported") que aparece semanas depois,
--    quando a primeira pessoa tenta entrar. Quais dessas colunas existem
--    muda com a versão do GoTrue, então cada uma é ajustada só se estiver lá.
do $$
declare
  col text;
begin
  foreach col in array array[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = col
    ) then
      execute format(
        'update auth.users set %I = '''' where %I is null and id in (select usuario_id from lote_temp.fila)',
        col, col
      );
    end if;
  end loop;
end $$;

-- 3. A identidade. Sem ela o GoTrue não encontra o usuário pelo e-mail e o
--    login falha com "Invalid login credentials" — a senha está certa, mas
--    não há por onde chegar nela. `provider_id` só existe nas versões mais
--    novas, daí a montagem dinâmica.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) then
    execute $q$
      insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), f.usuario_id, 'email', f.usuario_id::text,
             jsonb_build_object('sub', f.usuario_id::text, 'email', f.email,
                                'email_verified', true, 'phone_verified', false),
             now(), now(), now()
        from lote_temp.fila f
    $q$;
  else
    execute $q$
      insert into auth.identities (id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), f.usuario_id, 'email',
             jsonb_build_object('sub', f.usuario_id::text, 'email', f.email,
                                'email_verified', true, 'phone_verified', false),
             now(), now(), now()
        from lote_temp.fila f
    $q$;
  end if;
end $$;

-- 4. O vínculo entre a ficha da escala e o login. Sem ele a pessoa entra no
--    sistema e encontra "Minha escala" vazia: o login existe, mas nada o liga
--    a quem aparece na grade. `perfil_id is null` na condição para o caso de
--    alguém ter sido ligado pela tela enquanto isto rodava.
update colaboradores c
   set perfil_id = f.usuario_id
  from lote_temp.fila f
 where c.id = f.colaborador_id
   and c.perfil_id is null;

-- 5. Conferência: os três números têm de ser iguais.
select
  (select count(*) from lote_temp.fila)                                             as na_fila,
  (select count(*) from perfis p join lote_temp.fila f on f.usuario_id = p.id)       as perfis_criados,
  (select count(*) from colaboradores c join lote_temp.fila f
     on f.colaborador_id = c.id and c.perfil_id = f.usuario_id)                      as fichas_ligadas;


-- ── PARTE 3 — A LISTA DE SENHAS ──────────────────────────────────────
--
-- Copie o resultado (o SQL Editor exporta em CSV) e distribua. Cada pessoa
-- recebe só a linha dela.

select f.nome, f.matricula, f.email, f.senha as senha_temporaria
from lote_temp.fila f
order by f.nome;


-- ── PARTE 4 — APAGAR A LISTA ─────────────────────────────────────────
--
-- Depois de copiar. Enquanto este schema existir, as senhas de todo mundo
-- estão em claro dentro do banco.

drop schema lote_temp cascade;
