#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Construye una imagen inmutable, respalda los datos y recrea el contenedor.
# Se ejecuta EN el servidor y espera estar en /opt/tridnd/.
#
# Variables que entrega el workflow:
#   TRIDND_IMAGE_TAG   etiqueta inmutable (normalmente el SHA completo)
#   TRIDND_GIT_SHA     revisión mostrada por /api/health
#   TRIDND_APP_VERSION versión de package.json
#   TRIDND_BUILD_TIME  fecha ISO-8601 UTC
# ----------------------------------------------------------------------------
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SOURCE_ARCHIVE="$SCRIPT_DIR/src.tar.gz"
SOURCE_DIR="$SCRIPT_DIR/src"
DATA_DIR="$SCRIPT_DIR/data"
BACKUP_ROOT="$SCRIPT_DIR/backups"
DEPLOY_ENV="$SCRIPT_DIR/.deploy.env"
PREVIOUS_ENV="$SCRIPT_DIR/.deploy.previous.env"
ROLLBACK_NEEDED=0

rollback_on_error() {
  local status=$?
  trap - ERR
  if [[ "$ROLLBACK_NEEDED" == "1" && -f "$PREVIOUS_ENV" ]]; then
    echo "El contenedor nuevo no quedó sano; restaurando la imagen anterior"
    cp -- "$PREVIOUS_ENV" "$DEPLOY_ENV"
    docker compose --env-file "$DEPLOY_ENV" up -d --remove-orphans app || true
  fi
  exit "$status"
}
trap rollback_on_error ERR

[[ -f "$SOURCE_ARCHIVE" ]] || { echo "Falta $SOURCE_ARCHIVE"; exit 1; }
[[ "$SOURCE_DIR" == "$SCRIPT_DIR/src" && "$SOURCE_DIR" != "/src" ]] || {
  echo "Ruta de fuentes inesperada: $SOURCE_DIR"
  exit 1
}

IMAGE_TAG="${TRIDND_IMAGE_TAG:-manual-$(date -u +%Y%m%d%H%M%S)}"
GIT_SHA="${TRIDND_GIT_SHA:-desconocido}"
APP_VERSION="${TRIDND_APP_VERSION:-0.1.0-dev}"
BUILD_TIME="${TRIDND_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Etiqueta de imagen no válida"; exit 1; }
IMAGE="tridnd:$IMAGE_TAG"

# El directorio es fijo y se valida arriba antes de sustituirlo.
rm -rf -- "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
tar -xzf "$SOURCE_ARCHIVE" -C "$SOURCE_DIR"

docker build \
  --build-arg "APP_VERSION=$APP_VERSION" \
  --build-arg "GIT_SHA=$GIT_SHA" \
  --build-arg "BUILD_TIME=$BUILD_TIME" \
  --label "org.opencontainers.image.source-revision=$GIT_SHA" \
  -t "$IMAGE" \
  "$SOURCE_DIR"

# Copia consistente de SQLite mediante la API online de better-sqlite3. Los
# ficheros del usuario se archivan aparte; nunca se copia el .db junto al WAL.
if docker container inspect tridnd-app >/dev/null 2>&1; then
  BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_SHA:0:12}"
  BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
  TEMP_DB_NAME=".predeploy-$BACKUP_ID.db"
  TEMP_DB_HOST="$DATA_DIR/$TEMP_DB_NAME"
  mkdir -p "$BACKUP_DIR"

  docker exec -e "BACKUP_TARGET=/app/server/data/$TEMP_DB_NAME" tridnd-app \
    node --input-type=module -e '
      import Database from "better-sqlite3";
      const source = new Database("/app/server/data/tri-dnd.db");
      await source.backup(process.env.BACKUP_TARGET);
      source.close();
      const backup = new Database(process.env.BACKUP_TARGET, { readonly: true });
      const integrity = backup.pragma("integrity_check", { simple: true });
      backup.close();
      if (integrity !== "ok") throw new Error(`Backup SQLite inválido: ${integrity}`);
    '
  mv -- "$TEMP_DB_HOST" "$BACKUP_DIR/tri-dnd.db"

  DATA_ENTRIES=()
  for entry in uploads narrative-media translations/es.json backups/narrativa jwt-secret.txt; do
    [[ -e "$DATA_DIR/$entry" ]] && DATA_ENTRIES+=("$entry")
  done
  if ((${#DATA_ENTRIES[@]})); then
    tar -czf "$BACKUP_DIR/files.tar.gz" -C "$DATA_DIR" "${DATA_ENTRIES[@]}"
  fi
  sha256sum "$BACKUP_DIR"/* > "$BACKUP_DIR/SHA256SUMS"
  printf '%s\n' "$BACKUP_ID" > "$SCRIPT_DIR/.last-backup"
  echo "Backup previo verificado: $BACKUP_DIR"
else
  echo "Primer despliegue: no existe un contenedor anterior que respaldar"
fi

if [[ -f "$DEPLOY_ENV" ]]; then
  cp -- "$DEPLOY_ENV" "$PREVIOUS_ENV"
elif docker container inspect tridnd-app >/dev/null 2>&1; then
  # Primera transición desde el antiguo `tridnd:latest`: registra también
  # esa imagen para que el primer despliegue versionado tenga rollback.
  CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' tridnd-app)"
  docker image inspect "$CURRENT_IMAGE" >/dev/null
  printf 'TRIDND_IMAGE=%s\n' "$CURRENT_IMAGE" > "$PREVIOUS_ENV"
fi
printf 'TRIDND_IMAGE=%s\n' "$IMAGE" > "$DEPLOY_ENV.tmp"
mv -- "$DEPLOY_ENV.tmp" "$DEPLOY_ENV"

ROLLBACK_NEEDED=1
docker compose --env-file "$DEPLOY_ENV" up -d --remove-orphans app

READY=0
for attempt in $(seq 1 6); do
  if docker exec -e "EXPECTED_SHA=$GIT_SHA" tridnd-app node -e '
    fetch("http://127.0.0.1:4000/api/health")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok || !body.database?.ok || body.commit !== process.env.EXPECTED_SHA) process.exit(1);
      })
      .catch(() => process.exit(1));
  '; then
    READY=1
    break
  fi
  sleep 5
done
[[ "$READY" == "1" ]]
ROLLBACK_NEEDED=0

echo "OK TriDnD actualizado: $IMAGE ($GIT_SHA)"
