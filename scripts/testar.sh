#!/usr/bin/env bash
# Bateria completa. Sem argumentos roda tudo; com um nome, roda só aquela parte.
#
#   ./scripts/testar.sh                 # tudo
#   ./scripts/testar.sh propriedades    # só o fuzzing do motor
#   RODADAS=50000 ./scripts/testar.sh propriedades
#
# As partes de banco precisam de um Postgres com as migrations aplicadas; o
# endereço vem de PGDATABASE/PGHOST/PGPORT, como em qualquer ferramenta libpq.
set -uo pipefail
cd "$(dirname "$0")/.."

alvo="${1:-tudo}"
falhas=0

quer() { [ "$alvo" = tudo ] || [ "$alvo" = "$1" ]; }
executa() {
  local nome="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$nome"
  if "$@"; then :; else falhas=$((falhas + 1)); printf '\033[31m   ✗ %s falhou\033[0m\n' "$nome"; fi
}

quer tipos        && executa 'Tipos'        npx tsc --noEmit
quer lint         && executa 'Lint'         npm run --silent lint
quer motor        && executa 'Motor'        npx tsx src/lib/domain/escalas/motor.teste.ts
# Estava de fora: `npm test` roda os dois, mas a bateria completa — que é a que
# se roda antes de commitar — só rodava o motor.
quer importacao   && executa 'Importação'   npx tsx src/lib/domain/escalas/importacao.teste.ts
quer propriedades && executa 'Propriedades' npx tsx src/lib/domain/escalas/motor.propriedades.ts
# Não toca em banco nem em rede: lê os `actions-*.ts` e cobra sessão e papel em
# cada função exportada. Fica junto dos testes rápidos porque é um deles.
quer autorizacao  && executa 'Autorização'  node supabase/tests/autorizacao.mjs
# Mesma ideia, outro invariante: a equipe só é avisada de mudança em escala
# PUBLICADA. A regra vive espalhada por três pontos de `actions-geracao.ts` e
# nenhum deles a declara inteira.
quer avisos       && executa 'Avisos'       node supabase/tests/avisos.mjs
quer build        && executa 'Build'        npm run --silent build

if quer banco; then
  if command -v psql >/dev/null 2>&1 && psql -c 'select 1' >/dev/null 2>&1; then
    executa 'RLS'          psql -q -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
    executa 'RLS avançado' psql -q -v ON_ERROR_STOP=1 -f supabase/tests/rls-avancado.sql
    executa 'Integridade'  psql -q -v ON_ERROR_STOP=1 -f supabase/tests/integridade.sql
    executa 'Feriados'     psql -q -v ON_ERROR_STOP=1 -f supabase/tests/feriados.sql
  else
    printf '\n\033[33m── Banco: pulado (sem psql conectável). Defina PGDATABASE/PGHOST.\033[0m\n'
  fi
fi

# Fora de `banco` porque não roda CONTRA um banco: cria e derruba os seus. E
# fora de `tudo` — daí a comparação direta em vez de `quer` —, porque recriar
# quatro bancos a cada commit custaria minutos, e o que ela cobre só muda quando
# alguém mexe em `supabase/migrations`. Rode-a quando mexer:
#
#   ./scripts/testar.sh migracoes
[ "$alvo" = migracoes ] && executa 'Migrations' ./supabase/tests/migracoes.sh

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[32mTUDO PASSOU\033[0m\n'
else
  printf '\033[31m%s parte(s) falharam\033[0m\n' "$falhas"; exit 1
fi
