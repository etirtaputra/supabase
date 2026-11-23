# ICAPROC — nightly database backup (Google Drive, encrypted)

Owner, 2026-11-23: *"yes, add the nightly backup to Google Drive"*. Supabase's
free plan keeps no backups we can restore; this is a copy we own.

**What it is.** `icaproc-db-backup.sh` runs every night on the agents' VPS
(root cron, outside every agent container). It dumps the ICAPROC database
(schemas `public`, `auth`, `storage`) with the `postgres:17` image's
`pg_dump`, reads the dump back and refuses one with fewer than 60 tables of
data, encrypts it (gpg, AES-256) with a passphrase only the owner keeps, and
uploads it to the shared drive **ICAPROC BACKUPS** as the agents' service
account, checking Drive's md5. One file a night:
`icaproc-db_YYYY-MM-DD_HHMM_WIB.dump.gpg`.

**Why each choice.**
- *Encrypted*: the service account is shared by every agent, and the dump
  holds costs, bank accounts and logins (MAX, sell side, must never see cost).
- *Its own shared drive, account as Contributor*: it can add a file and can
  never delete one, so a bad night (or an agent mistake) cannot erase a good
  backup. Only the owner is a member besides the account.
- *Outside the containers*: an agent never sees the database password.
- *The files in storage (Inbox documents) are not in it*: they are filed to
  Drive by MIRA (purchasing sync runbook §11.7).

Tested 2026-11-23 against a local Postgres and a stand-in Google that checks
the signed sign-in like Google does: dump → encrypt → upload → md5 check,
then decrypt → `pg_restore` (17) into an empty database → identical rows.
Refuses: a wrong key (Google sign-in), too few tables, a wrong passphrase on
restore, an unknown drive name.

## Setup (once, hPanel → VPS → Terminal, as root)

Before: (1) create the shared drive **ICAPROC BACKUPS** in Google Drive and
add `hermes-drive-agent-365@icaproc-purchasing.iam.gserviceaccount.com` as
**Contributor** (no one else); (2) in Supabase → Connect → **Session pooler**,
copy the connection string with the database password in it (Project
Settings → Database → Reset database password if nobody has it — nothing else
uses that password).

```
apt-get install -y jq gnupg
mkdir -p /root/.icaproc-backup && chmod 700 /root/.icaproc-backup && cd /root/.icaproc-backup
curl -fsSL https://raw.githubusercontent.com/etirtaputra/supabase/<COMMIT>/ops/backup/icaproc-db-backup.sh -o icaproc-db-backup.sh && chmod 700 icaproc-db-backup.sh
cp /docker/hermes-agent-r33y/data/.hermes/credentials/gdrive.json sa.json && chmod 600 sa.json
openssl rand -base64 32 > passphrase && chmod 600 passphrase && cat passphrase
read -rsp "Paste the Supabase connection string, then Enter: " PGURL; echo
printf 'PGURL=%q\nPASSPHRASE_FILE=/root/.icaproc-backup/passphrase\nSA_FILE=/root/.icaproc-backup/sa.json\n' "$PGURL" > backup.env && chmod 600 backup.env && unset PGURL
/root/.icaproc-backup/icaproc-db-backup.sh
(crontab -l 2>/dev/null; echo '30 19 * * * /root/.icaproc-backup/icaproc-db-backup.sh >> /var/log/icaproc-backup.log 2>&1') | crontab -
```

**The passphrase printed by `cat passphrase` must be saved by the owner in his
password manager.** Without it no backup can ever be opened. 19:30 server
time = 02:30 WIB when the server runs on UTC (`date` shows it).

## Restore

1. Download the night's `.dump.gpg` from ICAPROC BACKUPS.
2. Decrypt (asks for the passphrase):
   `gpg -d -o icaproc.dump icaproc-db_….dump.gpg`
3. Restore into an EMPTY Supabase project (or a branch) — never over the live
   one without the owner's go:
   `docker run --rm -v "$PWD:/w" postgres:17-alpine pg_restore --no-owner -d "<new project's session pooler URL>" /w/icaproc.dump`
   "already exists" lines for schemas Supabase creates itself are expected.
4. Check row counts of the main tables against the backup's night.

## Check it is running

One new file per night in ICAPROC BACKUPS. On the server:
`tail /var/log/icaproc-backup.log` — each night ends with `OK …` or `FAILED: …`.
