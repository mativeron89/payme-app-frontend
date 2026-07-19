#!/usr/bin/env bash
# T7 — prepara la base local para el backend real.
#
# Qué hace:
#   1. Verifica que psql esté disponible (Postgres.app instalado).
#   2. Crea la base `payme` si no existe.
#   3. Corre las 4 migraciones del backend (schema + garantía + abono + outbox).
#   4. Siembra un restaurante activo y muestra su uuid (necesario por G-01:
#      POST /mesas exige restaurant_id y el contrato no expone la lista).
#
# NO toca ni un archivo de payme-app-backend: solo lee sus .sql y escribe en la
# base. El repo del backend es de solo lectura (regla del proyecto).
#
# Uso:  bash scripts/t7-setup-db.sh
set -euo pipefail

BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../payme-app-backend" && pwd)"
DB_NAME="${DB_NAME:-payme}"
export DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/${DB_NAME}}"

if ! command -v psql >/dev/null 2>&1; then
  cat <<'EOF'
✗ No encuentro `psql`.

Si ya instalaste Postgres.app, falta agregar sus herramientas al PATH:

  sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin \
    | sudo tee /etc/paths.d/postgresapp

Después cerrá y volvé a abrir la terminal (o reiniciá esta sesión) y corré el script de nuevo.
EOF
  exit 1
fi

echo "▸ Postgres: $(psql --version)"

if ! psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  echo "▸ Creando base '$DB_NAME'…"
  createdb "$DB_NAME"
else
  echo "▸ La base '$DB_NAME' ya existe."
fi

echo "▸ Corriendo migraciones del backend (solo lectura de sus .sql)…"
for f in \
  db/schema.sql \
  db/migrate_garantia_v2.9_hardened.sql \
  db/migrate_abono_spei_v2.8.sql \
  db/migrate_outbox_v2.12.sql
do
  echo "   · $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$BACKEND/$f"
done

echo "▸ Sembrando restaurante de prueba (G-01)…"
RESTAURANT_ID=$(psql "$DATABASE_URL" -t -A -c "
  INSERT INTO restaurants (name, category, address, clabe, rfc, status)
  SELECT 'La Parolaccia', 'italian', 'Roma Norte, CDMX', '646180000000000001', 'XAXX010101000', 'active'
  WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE name = 'La Parolaccia')
  RETURNING id;
")

if [ -z "$RESTAURANT_ID" ]; then
  RESTAURANT_ID=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT id FROM restaurants WHERE name = 'La Parolaccia' LIMIT 1;")
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "  Base lista."
echo "  restaurant_id: $RESTAURANT_ID"
echo
echo "  Poné esto en payme-app-frontend/.env.local :"
echo "    VITE_RESTAURANT_ID=$RESTAURANT_ID"
echo "═══════════════════════════════════════════════════════"
