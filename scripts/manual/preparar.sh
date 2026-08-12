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
# O cluster precisa aceitar conexão local sem senha, porque o dev server roda
# com um usuário do sistema diferente de `postgres`. Numa instalação Debian
# recém-criada isso não vale — o socket vem com `peer`, e o app falha com
# "Peer authentication failed for user postgres" que não parece o que é. Em
# `/etc/postgresql/<versão>/main/pg_hba.conf`, as duas linhas `local all` devem
# estar como `trust`. É um cluster de teste; não faça isso em outro lugar.
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
  psql_ -d "$banco" \
    -c "grant usage on schema public, auth to app_user" \
    -c "grant select, insert, update, delete on all tables in schema public to app_user" \
    -c "grant select on auth.users to app_user" \
    -c "grant usage, select on all sequences in schema public to app_user"

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
