#!/usr/bin/env bash
#
# O script `supabase/criar-acessos-em-lote.sql`, exercitado num banco de
# verdade.
#
#   supabase/tests/lote-sql.sh
#
# Ele existe porque aquele script escreve em `auth.users` à mão, e errar ali
# não dá erro: dá um usuário que ENTRA no banco e não CONSEGUE ENTRAR no
# sistema. As três formas de errar assim, todas cobertas abaixo:
#
#  · a senha gravada de um jeito que o GoTrue não confere no login;
#  · a coluna de texto deixada nula, que derruba o login semanas depois com
#    "converting NULL to string is unsupported";
#  · a identidade que falta, e o login responde "Invalid login credentials"
#    com a senha certa.
#
# E cobre os dois modos de senha, porque a diferença entre eles é uma linha que
# alguém edita à mão: a comum a todos e a sorteada por pessoa. Mais a recusa —
# rodar sem editar aquela linha não pode criar conta nenhuma, senão o lote
# nasce com a senha que está publicada no repositório.
#
# O que este teste NÃO prova: que o GoTrue de verdade aceita estas linhas. Isso
# só um login real demonstra. O que ele prova é que o estado gravado é o mesmo
# que a API de admin grava, conferido campo a campo — inclusive o bcrypt, que é
# verificado aqui com a mesma função que o GoTrue usa lá.
#
# Variáveis: PGHOST, PGPORT, PGUSER — como em qualquer ferramenta libpq.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"

BANCO=lote_sql_teste
SENHA_COMUM='SenhaComum2026'
TMP_SQL=""
falhas=0
ok()   { printf '  \033[32mok\033[0m: %s\n' "$1"; }
erro() { printf '  \033[31mFALHOU\033[0m: %s\n' "$1"; falhas=$((falhas + 1)); }
valor() { psql -tAX -d "$BANCO" -c "$1" 2>/dev/null | tr -d '[:space:]'; }
conferir() { # esperado, obtido, rótulo
  [ "$1" = "$2" ] && ok "$3 ($2)" || erro "$3 — esperava $1, veio $2"
}
titulo() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

limpar() {
  dropdb --if-exists "$BANCO" >/dev/null 2>&1
  [ -n "$TMP_SQL" ] && rm -f "$TMP_SQL"
}
trap limpar EXIT

# Uma variante do script com a PARTE 0 já editada. A PARTE 4 não precisa ser
# retirada: ela já vem comentada no arquivo, que é o que torna seguro rodar
# tudo de uma vez — e é isso que este teste exercita.
variante() { # $1 = senha ('' para o modo sorteado)
  [ -n "$TMP_SQL" ] && rm -f "$TMP_SQL"
  TMP_SQL="$(mktemp)"
  sed "s/'TROQUE-ESTA-SENHA'::text/'$1'::text/" supabase/criar-acessos-em-lote.sql > "$TMP_SQL"
}

# As linhas de uma parte só, para rodá-la isolada — como faz quem seleciona um
# trecho no SQL Editor e tecla Ctrl+Enter.
parte() { # $1 = número da parte
  awk -v alvo="$1" '
    /^-- ── PARTE [0-9]/ { atual = $4 }
    atual == alvo       { print }
  ' "$TMP_SQL"
}

montar_banco() {
  dropdb --if-exists "$BANCO" >/dev/null 2>&1
  createdb "$BANCO" || return 1
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f scripts/manual/auth-stub.sql >/dev/null 2>&1 || return 1
  for arquivo in supabase/migrations/*.sql; do
    psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$arquivo" >/dev/null 2>&1 || {
      erro "migration $(basename "$arquivo") não aplicou"; return 1; }
  done

  # O `auth` do stub tem só o que as migrations exigem. O script de lote escreve
  # no `auth` do GoTrue, que tem muito mais — então aqui ele é aproximado do de
  # verdade, coluna por coluna, senão o teste passaria sem tocar no que importa.
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" >/dev/null 2>&1 <<'SQL' || return 1
create extension if not exists pgcrypto with schema public;
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud varchar(255),
  add column if not exists role varchar(255),
  add column if not exists encrypted_password varchar(255),
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists raw_app_meta_data jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists confirmation_token varchar(255),
  add column if not exists recovery_token varchar(255),
  add column if not exists email_change varchar(255),
  add column if not exists email_change_token_new varchar(255),
  add column if not exists email_change_token_current varchar(255),
  add column if not exists phone_change varchar(255),
  add column if not exists phone_change_token varchar(255),
  add column if not exists reauthentication_token varchar(255);
create table if not exists auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider, provider_id)
);
SQL

  # A massa: um de cada caso que o script tem de separar. Montada à mão, e não
  # pela semeadura do app, porque o que se testa aqui é a TRIAGEM — e uma massa
  # realista traria dezenas de pessoas idênticas entre si, que não provam nada.
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" >/dev/null 2>&1 <<'SQL' || return 1
insert into contas (id, nome) values ('33333333-3333-3333-3333-333333333333', 'Área de Teste');
-- `overriding system value` porque as chaves são `generated always`: fixar os
-- ids deixa a massa legível, e ninguém depende deles fora daqui.
insert into unidades (id, conta_id, codigo, nome, sigla) overriding system value
  values (1, '33333333-3333-3333-3333-333333333333', 'U1', 'Unidade Um', 'U1');
insert into equipes (id, conta_id, codigo, nome) overriding system value
  values (1, '33333333-3333-3333-3333-333333333333', 'E1', 'Equipe Um');

-- Alguém que JÁ tem login: o usuário nasce pelo gatilho, como na vida real.
insert into auth.users (id, email, raw_user_meta_data)
values ('44444444-4444-4444-4444-444444444444', 'fabio@x.com',
        '{"nome":"Fabio Com Login","papel":"colaborador","conta_id":"33333333-3333-3333-3333-333333333333"}'::jsonb);

insert into colaboradores (id, conta_id, nome, matricula, email, equipe_id, unidade_base_id, status, perfil_id) overriding system value values
  (1, '33333333-3333-3333-3333-333333333333', 'Ana Pronta',      'M1', 'ana@x.com',   1, 1, 'ativo',    null),
  (2, '33333333-3333-3333-3333-333333333333', 'Bruno Sem Email', 'M2', '',            1, 1, 'ativo',    null),
  (3, '33333333-3333-3333-3333-333333333333', 'Carla Afastada',  'M3', 'carla@x.com', 1, 1, 'afastado', null),
  (4, '33333333-3333-3333-3333-333333333333', 'Davi Dividido',   'M4', 'mesmo@x.com', 1, 1, 'ativo',    null),
  (5, '33333333-3333-3333-3333-333333333333', 'Elis Dividida',   'M5', 'mesmo@x.com', 1, 1, 'ativo',    null),
  (6, '33333333-3333-3333-3333-333333333333', 'Gil Email Torto', 'M6', 'gil@@',       1, 1, 'ativo',    null),
  (7, '33333333-3333-3333-3333-333333333333', 'Fabio Com Login', 'M7', 'fabio@x.com', 1, 1, 'ativo',
     '44444444-4444-4444-4444-444444444444');
SQL
}


# ── 1. A recusa ──────────────────────────────────────────────────────
#
# Rodar sem editar a PARTE 0 não pode criar conta nenhuma. Sem esta trava, um
# "rodar tudo" distraído daria a oitenta pessoas a senha que está no Git.
titulo 'Sem editar a PARTE 0, o script recusa'
montar_banco || exit 1
saida="$(psql -v ON_ERROR_STOP=1 -d "$BANCO" -f supabase/criar-acessos-em-lote.sql 2>&1)"
case "$saida" in
  *'Edite a PARTE 0'*) ok 'recusa, dizendo o que editar' ;;
  *) erro "devia recusar com 'Edite a PARTE 0'; veio: $(printf '%s' "$saida" | tail -1)" ;;
esac
conferir 0 "$(valor 'select count(*) from auth.users where encrypted_password is not null')" \
  'e não criou conta nenhuma'


# ── 2. Senha comum a todos ───────────────────────────────────────────
titulo 'Senha comum: quem entrou, e quem não'
montar_banco || exit 1
variante "$SENHA_COMUM"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$TMP_SQL" >/dev/null 2>&1 \
  || { erro 'o script não rodou até o fim'; exit 1; }

conferir 2 "$(valor 'select count(*) from lote_temp.fila')" 'entraram dois — Ana e um dos que dividem o e-mail'
conferir 1 "$(valor "select count(*) from lote_temp.fila where nome = 'Ana Pronta'")" 'Ana entrou'
conferir 1 "$(valor "select count(*) from lote_temp.fila where email = 'mesmo@x.com'")" 'do e-mail repetido, um só'
conferir 4 "$(valor 'select count(*) from colaboradores where perfil_id is null')" \
  'os outros quatro continuam sem login (sem e-mail, afastada, e-mail torto e o segundo do par)'
conferir 0 "$(valor "select count(*) from lote_temp.fila where nome in ('Bruno Sem Email','Carla Afastada','Gil Email Torto','Fabio Com Login')")" \
  'nenhum dos recusados entrou na fila'

titulo 'Senha comum: o que foi gravado'
conferir 2 "$(valor "select count(*) from lote_temp.fila where senha = '$SENHA_COMUM'")" \
  'todos ficaram com a senha escolhida na PARTE 0'
conferir 2 "$(valor 'select count(*) from lote_temp.fila f join auth.users u on u.id = f.usuario_id
                      where u.encrypted_password = crypt(f.senha, u.encrypted_password)')" \
  'a senha confere pelo bcrypt, que é o que o GoTrue faz no login'
# Mesma senha, hashes diferentes: é o sal do bcrypt fazendo o trabalho dele.
# Se saíssem iguais, o banco estaria anunciando quem compartilha senha com quem.
conferir 2 "$(valor 'select count(distinct u.encrypted_password) from auth.users u
                      join lote_temp.fila f on f.usuario_id = u.id')" \
  'e mesmo assim cada hash é diferente, porque o sal é sorteado'
conferir 2 "$(valor 'select count(*) from auth.identities i join lote_temp.fila f on f.usuario_id = i.user_id
                      where i.provider = $$email$$ and i.identity_data->>$$sub$$ = f.usuario_id::text')" \
  'a identidade de e-mail existe, com o sub certo'
conferir 2 "$(valor 'select count(*) from perfis p join lote_temp.fila f on f.usuario_id = p.id
                      where p.papel = $$colaborador$$ and p.precisa_trocar_senha
                        and p.conta_id = $$33333333-3333-3333-3333-333333333333$$')" \
  'o perfil nasceu na área certa, como colaborador'
conferir 2 "$(valor 'select count(*) from colaboradores c join lote_temp.fila f on f.colaborador_id = c.id
                      where c.perfil_id = f.usuario_id')" \
  'a ficha da escala ficou ligada ao login'
conferir 0 "$(valor 'select count(*) from auth.users u join lote_temp.fila f on f.usuario_id = u.id
                      where u.confirmation_token is null or u.recovery_token is null
                         or u.email_change is null or u.email_change_token_new is null
                         or u.email_change_token_current is null or u.phone_change is null
                         or u.phone_change_token is null or u.reauthentication_token is null')" \
  'nenhuma coluna de texto do GoTrue ficou nula'
conferir 2 "$(valor 'select count(*) from auth.users u join lote_temp.fila f on f.usuario_id = u.id
                      where u.aud = $$authenticated$$ and u.role = $$authenticated$$
                        and u.email_confirmed_at is not null
                        and u.raw_app_meta_data->>$$provider$$ = $$email$$')" \
  'aud, role, e-mail confirmado e provedor preenchidos'

titulo 'Senha comum: rodar de novo não duplica ninguém'
antes="$(valor 'select count(*) from auth.users')"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$TMP_SQL" >/dev/null 2>&1
conferir 0 "$(valor 'select count(*) from lote_temp.fila')" 'a segunda passada não encontra ninguém'
conferir "$antes" "$(valor 'select count(*) from auth.users')" 'nenhum usuário novo no Auth'


# ── 3. Uma senha por pessoa ──────────────────────────────────────────
titulo 'Modo sorteado: uma senha diferente para cada'
montar_banco || exit 1
variante ''
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$TMP_SQL" >/dev/null 2>&1 \
  || { erro 'o script não rodou até o fim no modo sorteado'; exit 1; }

conferir 2 "$(valor 'select count(*) from lote_temp.fila')" 'os mesmos dois entraram'
conferir 2 "$(valor 'select count(distinct senha) from lote_temp.fila')" 'duas senhas diferentes'
conferir 2 "$(valor 'select count(*) from lote_temp.fila
                      where length(senha) = 12 and senha !~ $$[^A-Za-z2-9]$$ and senha !~ $$[O0Il1]$$')" \
  'doze caracteres, sem os que se confundem ao ditar'
conferir 2 "$(valor 'select count(*) from lote_temp.fila f join auth.users u on u.id = f.usuario_id
                      where u.encrypted_password = crypt(f.senha, u.encrypted_password)')" \
  'cada uma confere pelo bcrypt'


# ── 4. Parte por parte, cada uma em sessão própria ───────────────────
#
# É assim que o script é usado: seleciona-se um trecho no SQL Editor e teclas
# Ctrl+Enter. Cada Run é uma SESSÃO NOVA — o que um `set` deixou configurado
# no anterior não está mais lá. Foi o que derrubou a primeira versão deste
# script, que dependia de um `set search_path` no topo do arquivo: rodando
# tudo de uma vez funcionava, e rodando por partes, como manda o cabeçalho,
# morria em "function gen_salt does not exist".
#
# Cada `psql` abaixo é uma conexão nova, que é a reprodução fiel disso.
titulo 'Cada parte roda sozinha, em sessão separada'
montar_banco || exit 1
variante "$SENHA_COMUM"
falhou=''
for p in 0 1 2 3; do
  parte "$p" | psql -q -v ON_ERROR_STOP=1 -d "$BANCO" >/dev/null 2>&1 || falhou="$falhou $p"
done
[ -z "$falhou" ] && ok 'as partes 0, 1, 2 e 3 rodam isoladas' \
                 || erro "parte(s) que falharam sozinhas:$falhou"
conferir 2 "$(valor 'select count(*) from lote_temp.fila')" 'e o resultado é o mesmo de rodar tudo junto'
conferir 2 "$(valor 'select count(*) from lote_temp.fila f join auth.users u on u.id = f.usuario_id
                      where u.encrypted_password = crypt(f.senha, u.encrypted_password)')" \
  'com o bcrypt gravado certo, que é o que o search_path solto quebrava'

# A PARTE 4 vem comentada, e é isso que faz "rodar tudo" não apagar a lista
# antes de alguém a ler. No modo sorteado, apagada ela não se recupera.
conferir 1 "$(valor "select count(*) from information_schema.schemata where schema_name = 'lote_temp'")" \
  'a lista sobrevive ao arquivo inteiro, porque a PARTE 4 está comentada'

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[32mLOTE SQL OK\033[0m\n'
else
  printf '\033[31m%s conferência(s) falharam\033[0m\n' "$falhas"; exit 1
fi
