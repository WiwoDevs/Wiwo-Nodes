#!/bin/sh
# Respaldo de la base PostgreSQL de sac.wiwo.
#
# Corre dentro del servicio "backup" de docker-compose.production.yml, con la imagen de
# PostgreSQL de la misma versión que la base. PGHOST, PGUSER, PGPASSWORD y PGDATABASE vienen
# del compose. Uso (ver docs/OPERATIONS_RUNBOOK.md, "Respaldos de la base"):
#
#   loop                 respaldo al arrancar si hoy no hay uno, y después uno por día
#   once                 un respaldo ahora
#   list                 respaldos guardados
#   restore <archivo>    reemplaza la base por ese respaldo (con api y worker detenidos)
#
# Los respaldos contienen mensajes y datos de clientes: los archivos quedan legibles solo por
# root (umask 077) y nunca se copian a repositorios, tickets ni chats.

set -u
umask 077

BACKUP_DIR=${SAC_FLOW_BACKUP_TARGET:-/backups}
RETENTION_DAYS=${SAC_FLOW_BACKUP_RETENTION_DAYS:-14}
BACKUP_HOUR_UTC=${SAC_FLOW_BACKUP_HOUR_UTC:-6}
# Los respaldos más recientes que nunca se borran, aunque el reloj o la retención fallen.
MIN_KEEP=3

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf '%s ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

case "$RETENTION_DAYS" in
  '' | *[!0-9]*) fail "SAC_FLOW_BACKUP_RETENTION_DAYS debe ser un número entero de días."; exit 2 ;;
esac
case "$BACKUP_HOUR_UTC" in
  '' | *[!0-9]*) fail "SAC_FLOW_BACKUP_HOUR_UTC debe ser una hora entre 0 y 23."; exit 2 ;;
esac
RETENTION_DAYS=$(expr "$RETENTION_DAYS" + 0)
BACKUP_HOUR_UTC=$(expr "$BACKUP_HOUR_UTC" + 0)
if [ "$RETENTION_DAYS" -lt 1 ]; then fail "SAC_FLOW_BACKUP_RETENTION_DAYS debe ser 1 o más."; exit 2; fi
if [ "$BACKUP_HOUR_UTC" -gt 23 ]; then fail "SAC_FLOW_BACKUP_HOUR_UTC debe ser una hora entre 0 y 23."; exit 2; fi

# Borra los respaldos con más de RETENTION_DAYS días, salvo los MIN_KEEP más recientes, y los
# archivos a medio escribir de un respaldo interrumpido.
prune() {
  position=0
  for file in $(ls -1t "$BACKUP_DIR"/sac-flow-*.dump 2>/dev/null); do
    position=$((position + 1))
    [ "$position" -le "$MIN_KEEP" ] && continue
    if [ -n "$(find "$file" -mtime +"$((RETENTION_DAYS - 1))" 2>/dev/null)" ]; then
      rm -f "$file" && log "Respaldo vencido eliminado: $(basename "$file")."
    fi
  done
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '.sac-flow-*.partial' -mmin +360 -exec rm -f {} + 2>/dev/null
  return 0
}

# Un respaldo completo. Se escribe primero a un archivo temporal, se comprueba que pg_restore
# lo pueda leer y recién ahí toma su nombre final: un respaldo fallido nunca reemplaza ni
# borra a los anteriores. Con "keep" no aplica la retención.
backup_once() {
  mode=${1:-prune}
  if ! mkdir -p "$BACKUP_DIR"; then fail "No se pudo crear $BACKUP_DIR."; return 1; fi
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  final="$BACKUP_DIR/sac-flow-$stamp.dump"
  partial="$BACKUP_DIR/.sac-flow-$stamp.dump.partial"
  log "Respaldando la base $PGDATABASE..."
  if ! pg_dump --format=custom --compress=6 --file="$partial"; then
    rm -f "$partial"
    fail "pg_dump falló. Los respaldos anteriores se conservan."
    return 1
  fi
  if ! pg_restore --list "$partial" >/dev/null; then
    rm -f "$partial"
    fail "El respaldo quedó ilegible y se descartó. Los anteriores se conservan."
    return 1
  fi
  if ! mv "$partial" "$final"; then
    rm -f "$partial"
    fail "No se pudo guardar $final."
    return 1
  fi
  log "Respaldo listo: $(basename "$final") ($(du -h "$final" | cut -f1))."
  [ "$mode" = "keep" ] || prune
  return 0
}

# Hasta tres intentos, separados por diez minutos.
backup_with_retries() {
  attempt=1
  until backup_once; do
    if [ "$attempt" -ge 3 ]; then
      fail "Tres intentos fallidos. Se vuelve a intentar en el próximo horario."
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 600
  done
}

has_backup_today() {
  ls "$BACKUP_DIR"/sac-flow-"$(date -u +%Y-%m-%d)"T*.dump >/dev/null 2>&1
}

seconds_until_next_run() {
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) $BACKUP_HOUR_UTC:00:00" +%s)
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  echo $((next - now))
}

run_loop() {
  log "Respaldo diario a las $BACKUP_HOUR_UTC:00 UTC en $BACKUP_DIR. Se guardan $RETENTION_DAYS días."
  has_backup_today || backup_with_retries
  while true; do
    sleep "$(seconds_until_next_run)"
    backup_with_retries
  done
}

list_backups() {
  if ! ls "$BACKUP_DIR"/sac-flow-*.dump >/dev/null 2>&1; then
    log "Todavía no hay respaldos en $BACKUP_DIR."
    return 0
  fi
  ls -lh "$BACKUP_DIR"/sac-flow-*.dump
}

restore_backup() {
  file=${1:-}
  if [ -z "$file" ]; then fail "Indique el respaldo: restore sac-flow-AAAA-MM-DDTHHMMSSZ.dump"; return 2; fi
  case "$file" in /*) ;; *) file="$BACKUP_DIR/$file" ;; esac
  if [ ! -f "$file" ]; then fail "No existe $file."; return 2; fi
  if [ "${SAC_FLOW_CONFIRM_RESTORE:-}" != "$PGDATABASE" ]; then
    fail "Restaurar reemplaza toda la base. Para confirmar, repita con SAC_FLOW_CONFIRM_RESTORE=$PGDATABASE."
    return 2
  fi
  if ! pg_restore --list "$file" >/dev/null; then fail "$file no es un respaldo válido."; return 1; fi

  others=$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'") || {
    fail "No se pudo conectar a la base."
    return 1
  }
  if [ "$others" != "0" ]; then
    fail "Hay $others conexiones abiertas a la base. Detenga api y worker antes de restaurar."
    return 1
  fi

  log "Respaldo de seguridad del estado actual antes de restaurar..."
  if ! backup_once keep; then fail "No se pudo respaldar el estado actual. No se restauró nada."; return 1; fi

  # Se vacía el esquema y se carga el respaldo en una sola transacción: si algo falla, la base
  # queda exactamente como estaba. Vaciar el esquema evita que queden tablas de migraciones
  # posteriores al respaldo; al volver a levantar la API, "migrate" las vuelve a aplicar.
  # El SQL se arma completo en un archivo antes de tocar la base, para no cargar nunca un
  # respaldo a medias.
  log "Restaurando $(basename "$file")..."
  script="$BACKUP_DIR/.sac-flow-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.partial"
  if ! {
    echo "DROP SCHEMA IF EXISTS public CASCADE;"
    echo "CREATE SCHEMA public;"
  } >"$script" || ! pg_restore --no-owner --no-privileges --file=- "$file" >>"$script"; then
    rm -f "$script"
    fail "No se pudo leer $(basename "$file"). No se restauró nada."
    return 1
  fi
  if PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 --single-transaction --file="$script" >/dev/null; then
    rm -f "$script"
    log "Restauración completa desde $(basename "$file"). Ya se pueden levantar api y worker."
    return 0
  fi
  rm -f "$script"
  fail "La restauración falló y se revirtió completa: la base quedó como estaba."
  return 1
}

command=${1:-loop}
case "$command" in
  loop) run_loop ;;
  once) backup_once ;;
  list) list_backups ;;
  restore) shift; restore_backup "${1:-}" ;;
  *) fail "Comando desconocido: $command (loop, once, list o restore <archivo>)."; exit 2 ;;
esac
