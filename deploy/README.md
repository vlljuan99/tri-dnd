# Operación de producción de TriDnD

La producción usa una imagen Docker inmutable por revisión: `tridnd:<commit-sha>`.
El archivo `/opt/tridnd/.deploy.env` registra qué imagen debe ejecutar Compose y
`/api/health` confirma la misma revisión, la versión y la migración de SQLite.

## Despliegue normal

El workflow manual `Deploy to Hetzner` es la única vía normal:

1. Instala exactamente los `package-lock.json` con `npm ci`.
2. Ejecuta todas las pruebas, el build de Vite y `npm audit` de producción.
3. Construye `tridnd:<sha>` en el VPS con metadatos OCI.
4. Antes de reiniciar, crea un backup online e íntegro de SQLite y archiva las
   subidas y medios privados.
5. Levanta la imagen por SHA y comprueba web, SQLite, SHA y Socket.IO.
6. Si el smoke test falla, vuelve automáticamente a la imagen anterior. El job
   permanece fallido para que el incidente sea visible.

Los backups viven en `/opt/tridnd/backups/<fecha>-<sha-corto>/` y contienen:

- `tri-dnd.db`, obtenido con la API online de SQLite y validado con
  `PRAGMA integrity_check`;
- `files.tar.gz`, con uploads, medios narrativos, traducciones, respaldos
  narrativos y el secreto JWT local cuando exista;
- `SHA256SUMS`, para verificar ambos artefactos.

No hay borrado automático de backups ni de imágenes etiquetadas. La retención
debe decidirse después de comprobar que existe una copia externa recuperable.

## Rollback del código

Para volver a la imagen inmediatamente anterior sin tocar datos:

```bash
cd /opt/tridnd
./rollback.sh
```

Para elegir una revisión que siga disponible en Docker:

```bash
cd /opt/tridnd
./rollback.sh <commit-sha>
```

Las migraciones de TriDnD son incrementales y no se revierten al cambiar de
imagen. Si el problema ha alterado datos, hay que restaurar también el backup.

## Restauración manual de datos

Esta operación es destructiva y debe hacerse con la aplicación detenida. Antes
de ejecutarla, se conserva una copia adicional del estado fallido.

```bash
cd /opt/tridnd
BACKUP_ID=<fecha-sha-del-directorio>
test -f "backups/$BACKUP_ID/tri-dnd.db"
cd "backups/$BACKUP_ID"
sha256sum -c SHA256SUMS
cd /opt/tridnd
docker compose --env-file .deploy.env stop app
cp -a data "backups/estado-fallido-$(date -u +%Y%m%dT%H%M%SZ)"
cp "backups/$BACKUP_ID/tri-dnd.db" data/tri-dnd.db
rm -f data/tri-dnd.db-wal data/tri-dnd.db-shm
test ! -f "backups/$BACKUP_ID/files.tar.gz" || tar -xzf "backups/$BACKUP_ID/files.tar.gz" -C data
docker compose --env-file .deploy.env up -d app
curl --fail https://tridnd.167-233-99-156.sslip.io/api/health
```

La ruta `BACKUP_ID` debe resolverse siempre dentro de `/opt/tridnd/backups` y
revisarse antes de copiar o borrar archivos.

## Monitor

`Monitor production` consulta cada 30 minutos el frontend, el health de SQLite
y el handshake de Socket.IO. Un fallo queda registrado como ejecución fallida
en GitHub Actions; se puede conectar después a un canal de avisos sin cambiar
el contrato de salud.
