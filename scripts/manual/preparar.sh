#!/usr/bin/env bash
#
# Levanta os bancos de teste do zero.
#
#   scripts/manual/preparar.sh              # manual, manual_0008 e rlstest
#   scripts/manual/preparar.sh manual       # só um deles
#
# Existe porque a receita estava só no README, em prosa, e refazê-la à mão toda
# vez que o ambiente é recriado custava vinte minutos e errava em algum passo —
# quase sempre o `grant`, que precisa ser refeito a cada migration que cria
# tabela nova. Um banco montado pela metade não falha: ele passa a suíte inteira
# escondendo o que não foi concedido.
#
# Variáveis: PGHOST (padrão /tmp), PGPORT (padrão 5433), PGUSER (padrão postgres).
#
# Duas coisas precisam estar ajustadas no cluster, e as duas se perdem quando o
# ambiente é recriado a partir da imagem — o que faz o erro parecer do app.
#
# 1. `pg_hba.conf`: as duas linhas `local all` devem estar como `trust`. O dev
#    server roda com um usuário do sistema diferente de `postgres`, e o padrão
#    Debian é `peer` — o app falha com "Peer authentication failed for user
#    postgres", que não parece o que é. É um cluster de teste; não faça isso em
#    outro lugar.
#
# 2. `postgresql.conf`: os scripts esperam `/tmp:5433`. O padrão da distribuição
#    é `/var/run/postgresql:5432`, e aí tudo morre em ECONNREFUSED. Ajuste o
#    cluster com `port = 5433` e
#    `unix_socket_directories = '/var/run/postgresql,/tmp'`, ou aponte
#    PGHOST/PGPORT para onde ele estiver — todos os scripts honram as duas.
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"

psql_() { psql -v ON_ERROR_STOP=1 -q "$@"; }

# `manual_0008` pula a 0009 e roda todo o resto. Não é "o banco parado na
# oitava migration": é a instalação que, por qualquer razão, não aplicou a que
# trocou as chaves estrangeiras por compostas — e que continua recebendo as
# migrations seguintes. É esse descompasso que as suítes precisam exercitar,
# porque é ele que existe no mundo real. Um banco que simplesmente para na 0008
# não exercitaria nada das features novas.
pular() {
  case "$1|$2" in
    manual_0008\|0009_*) return 0 ;;
    *)                   return 1 ;;
  esac
}

preparar() {
  local banco="$1"
  echo "── $banco"

  dropdb --if-exists "$banco"
  createdb "$banco"
  psql_ -d "$banco" -f "$raiz/scripts/manual/auth-stub.sql"

  # `authenticated` e `anon` precisam existir ANTES das migrations.
  #
  # No Supabase são os papéis que o PostgREST assume — logado e anônimo — e
  # várias migrations fazem `grant`/`revoke` sobre eles dentro de um
  # `if exists (select 1 from pg_roles ...)`. Sem os papéis no cluster esse
  # `if` é sempre falso, TODO bloco de concessão vira código morto, e o
  # ambiente de teste perde a capacidade de enxergar um grant errado.
  #
  # Foi por essa fresta que a 0022 concedeu a `authenticated` uma função
  # `security definer` que recebia a área por parâmetro, sem nenhuma suíte
  # reclamar. Ver `supabase/tests/rls-avancado.sql`.
  psql_ -d postgres -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
  end \$\$;"

  for arquivo in "$raiz"/supabase/migrations/*.sql; do
    pular "$banco" "$(basename "$arquivo")" && continue
    psql_ -d "$banco" -f "$arquivo" > /dev/null
  done

  # Papel sem BYPASSRLS: é o que faz as policies realmente valerem. Rodando como
  # superusuário, toda a suíte de RLS passa sem testar nada.
  psql_ -d postgres -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'app_user') then
      create role app_user nologin;
    end if;
  end \$\$;"

  # Os grants vêm DEPOIS das migrations, e por banco: `grant ... on all tables`
  # é uma foto do momento, não uma regra permanente. Toda migration que cria
  # tabela exige repetir isto — foi assim que o mural apareceu vazio na
  # primeira execução depois da 0011.
  #
  # O grant de função é o análogo do `grant execute ... to authenticated` da
  # 0015: aquela migration revoga `resumo_areas()` de `public`, e sem esta linha
  # o console de áreas viria vazio contra o shim — com cara de "nenhuma área
  # cadastrada", não de permissão faltando.
  psql_ -d "$banco" \
    -c "grant usage on schema public, auth to app_user" \
    -c "grant select, insert, update, delete on all tables in schema public to app_user" \
    -c "grant select on auth.users to app_user" \
    -c "grant usage, select on all sequences in schema public to app_user" \
    -c "grant execute on all functions in schema public to app_user"

  if [ "$banco" != "rlstest" ]; then
    PGDATABASE="$banco" npx tsx "$raiz/scripts/manual/semear.ts"
  fi
}

# Array, e não `"${@:-a b c}"`: entre aspas aquilo vira UMA palavra, e o script
# tentava criar um banco chamado "manual manual_0008 rlstest".
bancos=("$@")
[ ${#bancos[@]} -eq 0 ] && bancos=(manual manual_0008 rlstest)

for banco in "${bancos[@]}"; do
  preparar "$banco"
done

echo
echo "pronto. Dev server:  PGDATABASE=manual npm run dev"
echo "Testes de RLS:       psql -d rlstest -f supabase/tests/rls.sql"
