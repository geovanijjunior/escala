#!/usr/bin/env bash
# Sobe um Postgres local para os testes do motor de slot (packages/engine,
# tests/04-*, tests/05-*). Idempotente: pode rodar de novo sem quebrar nada.
#
#   ./scripts/slot-db-setup.sh
#
# Testes que precisam de banco pulam sozinhos (com aviso) se ele não
# estiver alcançável em SLOT_TEST_DATABASE_URL — por padrão,
# postgres://escala_slot:escala_slot@127.0.0.1:5432/escala_slot.
set -euo pipefail

service postgresql start 2>/dev/null || pg_ctlcluster 16 main start

sudo -u postgres psql -v ON_ERROR_STOP=0 -c \
  "CREATE ROLE escala_slot LOGIN PASSWORD 'escala_slot' SUPERUSER;" 2>/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=0 -c \
  "CREATE DATABASE escala_slot OWNER escala_slot;" 2>/dev/null || true

PGPASSWORD=escala_slot psql -h 127.0.0.1 -U escala_slot -d escala_slot -c "select 1" >/dev/null
echo "banco pronto: postgres://escala_slot:escala_slot@127.0.0.1:5432/escala_slot"
