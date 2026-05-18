#!/bin/sh
# setup-db.sh — Configure Prisma schema and migrations for the target database.
#
# Provider selection (checked in order):
#   1. DB_PROVIDER env var           (build-time, e.g. DB_PROVIDER=postgresql)
#   2. First positional argument     (e.g. ./setup-db.sh postgresql)
#   3. Auto-detect from DATABASE_URL (runtime fallback)
#
# Usage (build-time — Docker / CI):
#   DB_PROVIDER=postgresql ./prisma/setup-db.sh
#
# Usage (local dev — auto-detect):
#   DATABASE_URL="postgresql://..." ./prisma/setup-db.sh
#   DATABASE_URL="file:./dev.db"    ./prisma/setup-db.sh
#
# This script is idempotent and safe to re-run.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_FILE="${SCHEMA_FILE:-${SCRIPT_DIR}/schema.prisma}"

# ---------------------------------------------------------------------------
# Resolve provider
# ---------------------------------------------------------------------------
resolve_provider() {
  # 1. Explicit env var
  if [ -n "${DB_PROVIDER:-}" ]; then
    echo "${DB_PROVIDER}"
    return
  fi

  # 2. Positional argument
  if [ -n "${1:-}" ]; then
    echo "$1"
    return
  fi

  # 3. Auto-detect from DATABASE_URL
  case "${DATABASE_URL:-}" in
    postgresql://*|postgres://*)
      echo "postgresql"
      ;;
    *)
      echo "sqlite"
      ;;
  esac
}

PROVIDER="$(resolve_provider "${1:-}")"

# Validate
case "${PROVIDER}" in
  sqlite|postgresql) ;;
  *)
    echo "[setup-db] ERROR: unsupported provider '${PROVIDER}'. Must be 'sqlite' or 'postgresql'." >&2
    exit 1
    ;;
esac

echo "[setup-db] Database provider: ${PROVIDER}"

# ---------------------------------------------------------------------------
# Rewrite the datasource provider in schema.prisma
# ---------------------------------------------------------------------------
if [ -f "${SCHEMA_FILE}" ]; then
  sed -i "s/provider *= *\"sqlite\"/provider = \"${PROVIDER}\"/" "${SCHEMA_FILE}"
  sed -i "s/provider *= *\"postgresql\"/provider = \"${PROVIDER}\"/" "${SCHEMA_FILE}"
  echo "[setup-db] Updated ${SCHEMA_FILE} → provider = \"${PROVIDER}\""
else
  echo "[setup-db] WARNING: ${SCHEMA_FILE} not found — skipping provider rewrite"
fi

# ---------------------------------------------------------------------------
# Install the correct migrations
# ---------------------------------------------------------------------------
if [ "${PROVIDER}" = "sqlite" ]; then
  echo "[setup-db] Using default SQLite migrations (migrations/)"
else
  MIGRATIONS_SRC="${SCRIPT_DIR}/migrations-${PROVIDER}"
  if [ -d "${MIGRATIONS_SRC}" ]; then
    echo "[setup-db] Installing ${PROVIDER} migrations from ${MIGRATIONS_SRC}..."
    mkdir -p "${SCRIPT_DIR}/migrations"
    rm -rf "${SCRIPT_DIR}/migrations/"*
    cp -R "${MIGRATIONS_SRC}/." "${SCRIPT_DIR}/migrations/"
    echo "[setup-db] ${PROVIDER} migrations installed"
  else
    echo "[setup-db] WARNING: No migrations found at ${MIGRATIONS_SRC}"
    echo "[setup-db] Run 'npx prisma migrate dev --name init' to create initial migrations."
  fi
fi

echo "[setup-db] Done (provider=${PROVIDER})"
