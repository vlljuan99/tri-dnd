#!/usr/bin/env bash
# Revierte solo el código a la imagen anterior o a un SHA indicado. No toca
# SQLite: las migraciones de TriDnD son incrementales. La restauración de datos
# es una operación manual separada descrita en deploy/README.md.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEPLOY_ENV="$SCRIPT_DIR/.deploy.env"
PREVIOUS_ENV="$SCRIPT_DIR/.deploy.previous.env"
TARGET_TAG="${1:-}"

if [[ -n "$TARGET_TAG" ]]; then
  [[ "$TARGET_TAG" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Etiqueta no válida"; exit 1; }
  TARGET_IMAGE="tridnd:$TARGET_TAG"
  docker image inspect "$TARGET_IMAGE" >/dev/null
  printf 'TRIDND_IMAGE=%s\n' "$TARGET_IMAGE" > "$DEPLOY_ENV.rollback"
else
  [[ -f "$PREVIOUS_ENV" ]] || { echo "No hay una imagen anterior registrada"; exit 1; }
  cp -- "$PREVIOUS_ENV" "$DEPLOY_ENV.rollback"
fi

if [[ -f "$DEPLOY_ENV" ]]; then
  cp -- "$DEPLOY_ENV" "$SCRIPT_DIR/.deploy.failed-$(date -u +%Y%m%dT%H%M%SZ).env"
fi
mv -- "$DEPLOY_ENV.rollback" "$DEPLOY_ENV"
docker compose --env-file "$DEPLOY_ENV" up -d --remove-orphans app

docker exec tridnd-app node -e '
  fetch("http://127.0.0.1:4000/api/health")
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.ok || (body.database && !body.database.ok)) process.exit(1);
      console.log(`Rollback sano: ${body.commit ?? "versión anterior"} · migración ${body.database?.migration ?? "sin metadatos"}`);
    })
    .catch((error) => { console.error(error); process.exit(1); });
'
