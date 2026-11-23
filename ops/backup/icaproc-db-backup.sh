#!/usr/bin/env bash
# ICAPROC — nightly database backup to Google Drive, encrypted (2026-11-23)
#
# Owner, 2026-11-23: "yes, add the nightly backup to Google Drive". Supabase's
# free plan keeps no backups we can restore; this is a copy WE own.
#
# Runs on the agents' VPS (root cron, not inside an agent container):
#   1. pg_dump the ICAPROC database — schemas public, auth (the logins) and
#      storage (file records; the files themselves are not in the database) —
#      in Postgres' compressed "custom" format, with the pg_dump that matches
#      the server (the postgres:17 Docker image), then read the dump back
#      (pg_restore --list) and refuse a dump with too few tables of data.
#   2. Encrypt it (gpg, AES-256) with a passphrase only the owner keeps. The
#      service account that uploads it is shared by every agent, and the dump
#      holds costs, bank accounts and logins: without the passphrase the file
#      is useless to anyone who can see the folder.
#   3. Upload it to the backup shared drive as the service account, and check
#      Drive's md5 equals ours. The account is a CONTRIBUTOR there: it can add
#      files and never delete one — a bad night cannot erase a good one.
#
# Restore: see ops/backup/README.md.
#
# Config: /root/.icaproc-backup/backup.env (chmod 600), or $ICAPROC_BACKUP_CONF:
#   PGURL            the Supabase "Session pooler" connection string
#   PASSPHRASE_FILE  the file holding the encryption passphrase
#   SA_FILE          the Google service-account JSON key
#   DRIVE_FOLDER_ID  the backup shared drive (or a folder in it). Empty: the
#                    shared drive named $DRIVE_NAME (default "ICAPROC BACKUPS")
#                    that the service account is a member of
#   PG_IMAGE         default postgres:17-alpine; set to "native" to use the
#                    host's own pg_dump (tests)
#   MIN_TABLES       default 60 — fewer tables of data means something is wrong
#   TOKEN_URL / DRIVE_API   overridable for tests only
# Exit 0 = backed up and verified; anything else = it did NOT happen.
set -euo pipefail

CONF="${ICAPROC_BACKUP_CONF:-/root/.icaproc-backup/backup.env}"
# shellcheck disable=SC1090
source "$CONF"
: "${PGURL:?PGURL missing in $CONF}"
: "${PASSPHRASE_FILE:?PASSPHRASE_FILE missing in $CONF}"
: "${SA_FILE:?SA_FILE missing in $CONF}"
DRIVE_FOLDER_ID="${DRIVE_FOLDER_ID:-}"
DRIVE_NAME="${DRIVE_NAME:-ICAPROC BACKUPS}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
MIN_TABLES="${MIN_TABLES:-60}"
TOKEN_URL="${TOKEN_URL:-https://oauth2.googleapis.com/token}"
DRIVE_API="${DRIVE_API:-https://www.googleapis.com}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(TZ=Asia/Jakarta date +%Y-%m-%d_%H%M)"
NAME="icaproc-db_${STAMP}_WIB.dump.gpg"

# ── 1. Dump, and read it back ────────────────────────────────────────────────
DUMP_ARGS=(--format=custom --compress=9 --no-owner --no-privileges
           --schema=public --schema=auth --schema=storage)
if [ "$PG_IMAGE" = "native" ]; then
  pg_dump "${DUMP_ARGS[@]}" --file="$WORK/db.dump" "$PGURL" || die "pg_dump"
  pg_restore --list "$WORK/db.dump" > "$WORK/list.txt" || die "pg_restore --list"
else
  # `-e PGURL` (no value) hands the variable over without putting the
  # password on the command line, where `ps` would show it — so export it.
  export PGURL
  docker run --rm --network host -e PGURL -v "$WORK:/out" "$PG_IMAGE" \
    sh -c 'pg_dump '"${DUMP_ARGS[*]}"' --file=/out/db.dump "$PGURL" && pg_restore --list /out/db.dump > /out/list.txt' \
    || die "pg_dump in $PG_IMAGE"
fi
TABLES="$(grep -c ' TABLE DATA ' "$WORK/list.txt" || true)"
[ "$TABLES" -ge "$MIN_TABLES" ] || die "only $TABLES tables of data in the dump (expected at least $MIN_TABLES)"
BYTES="$(stat -c %s "$WORK/db.dump")"
log "dumped: $TABLES tables of data, $BYTES bytes"

# ── 2. Encrypt ───────────────────────────────────────────────────────────────
[ -s "$PASSPHRASE_FILE" ] || die "passphrase file is empty or missing"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$WORK/$NAME" "$WORK/db.dump" || die "gpg"
rm -f "$WORK/db.dump"
MD5="$(md5sum "$WORK/$NAME" | cut -d' ' -f1)"

# ── 3. Upload as the service account ─────────────────────────────────────────
b64url() { openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }
EMAIL="$(jq -r .client_email "$SA_FILE")"
jq -r .private_key "$SA_FILE" > "$WORK/key.pem"
NOW="$(date +%s)"
HEADER="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
CLAIMS="$(jq -cn --arg iss "$EMAIL" --arg aud "$TOKEN_URL" --argjson iat "$NOW" \
  '{iss:$iss, scope:"https://www.googleapis.com/auth/drive", aud:$aud, iat:$iat, exp:($iat+3600)}' | b64url)"
SIG="$(printf '%s.%s' "$HEADER" "$CLAIMS" | openssl dgst -sha256 -sign "$WORK/key.pem" | b64url)"
rm -f "$WORK/key.pem"
TOKEN="$(curl -sS --fail-with-body -X POST "$TOKEN_URL" \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
  --data-urlencode "assertion=$HEADER.$CLAIMS.$SIG" | jq -r .access_token)" || die "Google sign-in"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || die "Google sign-in returned no token"

# Where: the configured folder, else the one shared drive with that name.
if [ -z "$DRIVE_FOLDER_ID" ]; then
  Q="$(jq -rn --arg n "$DRIVE_NAME" '"name = \u0027" + $n + "\u0027" | @uri')"
  DRIVES="$(curl -sS --fail-with-body "$DRIVE_API/drive/v3/drives?q=$Q&fields=drives(id,name)" \
    -H "Authorization: Bearer $TOKEN")" || die "listing shared drives"
  [ "$(printf '%s' "$DRIVES" | jq '.drives | length')" = "1" ] \
    || die "expected exactly one shared drive named \"$DRIVE_NAME\" with the service account in it; found: $(printf '%s' "$DRIVES" | jq -c '[.drives[].name]')"
  DRIVE_FOLDER_ID="$(printf '%s' "$DRIVES" | jq -r '.drives[0].id')"
fi

# Resumable upload: one request for the name and folder, one for the bytes.
META="$(jq -cn --arg n "$NAME" --arg p "$DRIVE_FOLDER_ID" '{name:$n, parents:[$p], mimeType:"application/pgp-encrypted"}')"
SESSION="$(curl -sS --fail-with-body -D - -o /dev/null -X POST \
  "$DRIVE_API/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json; charset=UTF-8' \
  -d "$META" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')" || die "Drive upload start"
[ -n "$SESSION" ] || die "Drive gave no upload address (is the account a member of the backup drive?)"
RESULT="$(curl -sS --fail-with-body -X PUT "$SESSION&fields=id,name,size,md5Checksum" \
  -H 'Content-Type: application/pgp-encrypted' --data-binary @"$WORK/$NAME")" || die "Drive upload"
DRIVE_MD5="$(printf '%s' "$RESULT" | jq -r .md5Checksum)"
[ "$DRIVE_MD5" = "$MD5" ] || die "Drive's copy differs (md5 $DRIVE_MD5, ours $MD5)"
log "OK $NAME → Drive file $(printf '%s' "$RESULT" | jq -r .id), $(printf '%s' "$RESULT" | jq -r .size) bytes, md5 $MD5"
