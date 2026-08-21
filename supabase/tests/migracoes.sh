#!/usr/bin/env bash
#
# Suíte das migrations. Verifica o que nenhum teste de dado alcança: se a
# INSTALAÇÃO chega inteira do outro lado.
#
#   supabase/tests/migracoes.sh
#
# Quatro coisas, e cada uma já quebrou de verdade:
#
# 1. Do zero. É o caminho de quem instala hoje.
#
# 2. Duas vezes seguidas. As migrations se dizem idempotentes, e é uma promessa
#    que se paga caro para descobrir que era falsa: quem roda a bateria de novo
#    depois de um erro no meio precisa que repetir não destrua nada.
#
# 3. Sem a 0009. Existe instalação que nunca aplicou a migration das chaves
#    compostas e continua recebendo as seguintes. Uma migration que declare FK
#    composta sem checar aborta ali — foi assim que a 0021 quebrou, e é por isso
#    que este teste existe.
#
# 4. O backfill da 0020, contra massa montada à mão no formato antigo. A
#    conversão de `jornada` (duração) para `saida` (horário) roda uma única vez
#    na vida de cada banco: ou está certa agora, ou o horário de todo mundo
#    fica errado sem ninguém perceber.
#
# Variáveis: PGHOST, PGPORT, PGUSER — como em qualquer ferramenta libpq.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"

falhas=0
ok()   { printf '  \033[32mok\033[0m: %s\n' "$1"; }
erro() { printf '  \033[31mFALHOU\033[0m: %s\n' "$1"; falhas=$((falhas + 1)); }
titulo() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

psql_() { psql -v ON_ERROR_STOP=1 -q "$@"; }
valor() { psql -tAX -d "$1" -c "$2" 2>/dev/null | tr -d '[:space:]'; }

# Aplica as migrations num banco. Com um segundo argumento, pula a migration
# cujo nome comece por ele.
aplicar() {
  local banco="$1" pular="${2:-}"
  for arquivo in supabase/migrations/*.sql; do
    [ -n "$pular" ] && case "$(basename "$arquivo")" in "$pular"*) continue ;; esac
    psql_ -d "$banco" -f "$arquivo" > /dev/null 2>&1 || {
      echo "     └─ parou em $(basename "$arquivo")"
      psql -d "$banco" -f "$arquivo" 2>&1 | grep -i '^psql.*ERROR' | head -3 | sed 's/^/     /'
      return 1
    }
  done
}

novo_banco() {
  dropdb --if-exists "$1" 2>/dev/null
  createdb "$1"
  psql_ -d "$1" -f scripts/manual/auth-stub.sql > /dev/null 2>&1
}

# ══════════════════════════════════════════════════════════════
titulo '1. Instalação do zero'
# ══════════════════════════════════════════════════════════════
novo_banco mig_zero
if aplicar mig_zero; then ok 'todas as migrations aplicam num banco vazio'
else erro 'a instalação do zero não chega ao fim'; fi

# As colunas que as três últimas migrations criam. Se a migration "passou" mas
# não deixou a coluna, o teste de dado seguinte falharia com uma mensagem que
# não fala de migration nenhuma.
for par in colaboradores:saida postos:equipe_id cotas_equipe:minimo; do
  tabela="${par%%:*}"; coluna="${par##*:}"
  n=$(valor mig_zero "select count(*) from information_schema.columns
       where table_name = '$tabela' and column_name = '$coluna'")
  [ "$n" = 1 ] && ok "$tabela.$coluna existe" || erro "$tabela.$coluna não foi criada"
done

# E as que foram removidas precisam ter sumido de fato: uma coluna `jornada`
# sobrevivente voltaria a ser lida por engano no primeiro `select *`.
for par in colaboradores:jornada cotas_equipe:limite; do
  tabela="${par%%:*}"; coluna="${par##*:}"
  n=$(valor mig_zero "select count(*) from information_schema.columns
       where table_name = '$tabela' and column_name = '$coluna'")
  [ "$n" = 0 ] && ok "$tabela.$coluna foi removida" || erro "$tabela.$coluna ainda existe"
done

# ══════════════════════════════════════════════════════════════
titulo '2. Aplicar tudo de novo, por cima'
# ══════════════════════════════════════════════════════════════
if aplicar mig_zero; then ok 'a segunda passada não quebra'
else erro 'repetir as migrations falha — a idempotência prometida não vale'; fi

for par in colaboradores:saida cotas_equipe:minimo; do
  tabela="${par%%:*}"; coluna="${par##*:}"
  n=$(valor mig_zero "select count(*) from information_schema.columns
       where table_name = '$tabela' and column_name = '$coluna'")
  [ "$n" = 1 ] && ok "$tabela.$coluna sobrevive à segunda passada" \
                || erro "$tabela.$coluna sumiu ao repetir as migrations"
done

# Uma FK duplicada não quebra nada hoje e vira erro estranho de exclusão amanhã.
n=$(valor mig_zero "select count(*) from pg_constraint
     where conrelid = 'postos'::regclass and contype = 'f' and conname like '%equipe%'")
[ "$n" = 1 ] && ok 'a FK de posto→equipe não duplicou' \
             || erro "postos tem $n FKs para equipes (esperado 1)"

# ══════════════════════════════════════════════════════════════
titulo '3. Instalação que nunca aplicou a 0009'
# ══════════════════════════════════════════════════════════════
novo_banco mig_sem0009
if aplicar mig_sem0009 0009; then ok 'as migrations seguintes aplicam sem a 0009'
else erro 'sem a 0009 a cadeia de migrations aborta'; fi

def=$(valor mig_sem0009 "select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'postos'::regclass and conname = 'postos_equipe_conta_fk'")
case "$def" in
  *'conta_id'*) erro 'sem a 0009 a FK de posto saiu composta — não deveria existir unicidade para isso' ;;
  *equipes*)    ok 'sem a 0009 a FK de posto cai para a forma simples' ;;
  *)            erro "FK de posto→equipe ausente sem a 0009 (def: ${def:-vazio})" ;;
esac

# ══════════════════════════════════════════════════════════════
titulo '4. Backfill da 0020: jornada (duração) → saída (horário)'
# ══════════════════════════════════════════════════════════════
# O banco é montado até a 0019 e recebe massa no formato antigo. Só então a
# 0020 roda — que é a única ordem em que o backfill é exercitado de verdade.
novo_banco mig_backfill
for arquivo in supabase/migrations/*.sql; do
  case "$(basename "$arquivo")" in 002[0-9]*) break ;; esac
  psql_ -d mig_backfill -f "$arquivo" > /dev/null 2>&1
done

psql_ -d mig_backfill > /dev/null 2>&1 <<'SQL'
alter table auth.users disable trigger on_auth_user_created;
insert into contas (id, nome) values ('99999999-9999-9999-9999-999999999999', 'Backfill');
-- `overriding system value` porque `id` é identity `generated always` desde a
-- 0018: sem isso o insert é recusado, e a massa deste teste precisa de ids
-- fixos para as linhas de colaborador apontarem para eles.
insert into equipes (id, conta_id, codigo, nome, regime, turno) overriding system value
  values (901, '99999999-9999-9999-9999-999999999999', 'E901', 'Equipe', '5x2', 'D');
insert into unidades (id, conta_id, codigo, nome, sigla, capacidade_total) overriding system value
  values (901, '99999999-9999-9999-9999-999999999999', 'U901', 'Unidade', 'UNI', 50);
-- Um caso por regra do cálculo antigo: acima de seis horas entra 1h de
-- intervalo, até seis não entra, e a virada da meia-noite precisa dar a volta.
-- 12x36 exige `ciclo` enquanto o CHECK da 0002 estiver de pé — e ele só cai na
-- 0020, que é justamente a migration sob teste. A massa precisa ser válida no
-- schema ANTERIOR a ela.
insert into colaboradores
  (conta_id, matricula, nome, cargo, equipe_id, unidade_base_id, regime, turno, entrada, jornada, ciclo, admissao)
values
  ('99999999-9999-9999-9999-999999999999','M1','Oito',  'analista',901,901,'5x2',  'D','08:00', 8,null,   '2020-01-01'),
  ('99999999-9999-9999-9999-999999999999','M2','Seis',  'analista',901,901,'5x2',  'D','08:00', 6,null,   '2020-01-01'),
  ('99999999-9999-9999-9999-999999999999','M3','Doze',  'tecnico', 901,901,'12x36','N','19:00',12,'IMPAR','2020-01-01'),
  ('99999999-9999-9999-9999-999999999999','M4','Quatro','analista',901,901,'5x2',  'D','13:00', 4,null,   '2020-01-01'),
  ('99999999-9999-9999-9999-999999999999','M5','Meia',  'tecnico', 901,901,'12x36','N','23:00', 2,'PAR',  '2020-01-01');
SQL

if psql_ -d mig_backfill -f supabase/migrations/0020_entrada_saida_e_ciclo.sql > /dev/null 2>&1
then ok 'a 0020 aplica sobre massa no formato antigo'
else erro 'a 0020 falha sobre massa no formato antigo'; fi

# A hora de intervalo entra no 5x2 e NÃO no 12x36:
#
#   Oito   5x2,   8h a partir das 08:00 → 17:00 (oito de trabalho, uma de almoço)
#   Seis   5x2,   6h a partir das 08:00 → 14:00 (até seis horas não há acréscimo)
#   Quatro 5x2,   4h a partir das 13:00 → 17:00
#   Doze   12x36, 12h a partir das 19:00 → 07:00 (plantão de ponta a ponta)
#   Meia   12x36,  2h a partir das 23:00 → 01:00 (dá a volta na meia-noite)
#
# O 07:00 do "Doze" é o ponto: a fórmula antiga somava a hora de intervalo a
# qualquer jornada acima de seis, e esticava o plantão de doze horas para treze.
esperado='Doze:07:00|Meia:01:00|Oito:17:00|Quatro:17:00|Seis:14:00'
obtido=$(valor mig_backfill "select string_agg(nome || ':' || saida, '|' order by nome) from colaboradores")
[ "$obtido" = "$esperado" ] && ok 'toda saída foi calculada certo' \
  || erro "saídas erradas
       esperado: $esperado
       obtido:   $obtido"

# ══════════════════════════════════════════════════════════════
titulo '4b. A 0025 conserta quem rodou a 0020 antiga'
# ══════════════════════════════════════════════════════════════
# A correção da fórmula não alcança quem já migrou: naquele banco `jornada` não
# existe mais, e o plantão já está gravado com treze horas. A 0025 é a passada
# de conserto, e precisa mexer SÓ no que está errado.
psql_ -d mig_backfill > /dev/null 2>&1 <<'SQL'
-- Repõe à mão o estrago que a 0020 antiga fazia, e mais dois casos que a 0025
-- não pode tocar: um plantão já correto e um turno de duração incomum que
-- alguém digitou de propósito.
update colaboradores set saida = '08:00' where nome = 'Doze';
insert into colaboradores
  (conta_id, matricula, nome, cargo, equipe_id, unidade_base_id, regime, turno, entrada, saida, ciclo, admissao)
values
  ('99999999-9999-9999-9999-999999999999','M6','Certo',   'tecnico',901,901,'12x36','N','07:00','19:00','IMPAR','2020-01-01'),
  ('99999999-9999-9999-9999-999999999999','M7','Diferente','tecnico',901,901,'12x36','N','07:00','17:00','PAR',  '2020-01-01');
SQL

if psql_ -d mig_backfill -f supabase/migrations/0025_plantao_de_doze_horas.sql > /dev/null 2>&1
then ok 'a 0025 aplica'
else erro 'a 0025 falha'; fi

for caso in Doze:07:00 Certo:19:00 Diferente:17:00 Oito:17:00; do
  # `#` e não `##`: o valor é um horário e tem dois-pontos dentro. `##*:` corta
  # até o ÚLTIMO, e "Doze:07:00" viraria "00".
  quem="${caso%%:*}"; deveria="${caso#*:}"
  tem=$(valor mig_backfill "select saida from colaboradores where nome = '$quem'")
  [ "$tem" = "$deveria" ] && ok "$quem ficou com $tem" \
    || erro "$quem ficou com $tem, esperado $deveria"
done

# Repetir não pode tirar mais uma hora: depois da primeira passada nenhum 12x36
# mede treze horas, que é justamente a condição que a migration procura.
psql_ -d mig_backfill -f supabase/migrations/0025_plantao_de_doze_horas.sql > /dev/null 2>&1
tem=$(valor mig_backfill "select saida from colaboradores where nome = 'Doze'")
[ "$tem" = '07:00' ] && ok 'repetir a 0025 não tira outra hora' \
                     || erro "repetir a 0025 levou Doze para $tem"

# ══════════════════════════════════════════════════════════════
titulo '5. Backfill sobre banco vazio'
# ══════════════════════════════════════════════════════════════
# Instalação nova não tem `jornada` para converter. O `default` da coluna é o
# que segura esse caso; sem ele a coluna nasceria nula e `not null` abortaria.
novo_banco mig_vazio
if aplicar mig_vazio; then
  padrao=$(valor mig_vazio "select column_default is not null or is_nullable = 'NO'
            from information_schema.columns
            where table_name = 'colaboradores' and column_name = 'saida'")
  [ "$padrao" = t ] && ok 'saida nasce utilizável num banco sem massa' \
                    || erro 'saida ficou sem default e sem not null'
else erro 'instalação vazia não chega ao fim'; fi

for banco in mig_zero mig_sem0009 mig_backfill mig_vazio; do dropdb --if-exists "$banco" 2>/dev/null; done

printf '\n'
if [ "$falhas" -eq 0 ]; then printf '\033[32m>>> MIGRATIONS OK\033[0m\n'
else printf '\033[31m>>> %s verificação(ões) falharam\033[0m\n' "$falhas"; exit 1; fi
