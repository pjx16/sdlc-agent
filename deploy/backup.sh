#!/bin/bash
# Daily encrypted database backup, run by the `backup` service (the postgres image: pg_dump, gzip and openssl, nothing else).
# The dump is gzipped, then encrypted with AES-256 under a PBKDF2 key from the install's ENCRYPTION_KEY (BACKUP_KEY here), with a
# fresh salt per file, so only ciphertext reaches the host folder. `sdlc-agent restore <file>` opens it with the same key.
# A backup is written when the newest one is older than 23 hours, so restarts do not pile them up; the newest BACKUP_KEEP are kept.
set -euo pipefail
dir=/backups
keep=${BACKUP_KEEP:-7}
: "${BACKUP_KEY:?BACKUP_KEY is not set}"
umask 077

backup_once() {
  local name part
  name="$dir/daily-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz.enc"
  part="$name.part"
  if pg_dump --no-owner | gzip | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_KEY > "$part"; then
    mv "$part" "$name"
    echo "backup: wrote $(basename "$name")"
    ls -1t "$dir"/daily-*.sql.gz.enc | tail -n +"$((keep + 1))" | xargs -r rm -f --
  else
    rm -f "$part"
    echo "backup: pg_dump failed; trying again in an hour" >&2
  fi
}

while :; do
  newest=$(ls -1t "$dir"/daily-*.sql.gz.enc 2>/dev/null | head -n 1 || true)
  if [ -z "$newest" ] || [ -n "$(find "$newest" -mmin +1380 2>/dev/null)" ]; then backup_once || true; fi
  sleep 3600
done
