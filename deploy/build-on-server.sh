#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Reconstruye tridnd:latest desde src.tar.gz y recrea el contenedor de la app.
# Se ejecuta EN el servidor. Espera estar en /opt/tridnd/.
# ----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

[[ -f src.tar.gz ]] || { echo "Falta src.tar.gz"; exit 1; }

rm -rf src && mkdir src
tar -xzf src.tar.gz -C src

docker build -t tridnd:latest src
docker compose up -d --remove-orphans app
docker image prune -f >/dev/null

echo "OK tridnd actualizado"
