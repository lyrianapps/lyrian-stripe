#!/bin/sh
# Wait for the Cloud SQL Auth Proxy sidecar to create its Unix socket before
# starting Next.js. The proxy runs alongside the app container on Cloud Run
# via --add-cloudsql-instances, but it takes a few seconds to mount the
# socket file. Without this wait the app starts, gets the first DB request,
# and fails with "connect EIO /cloudsql/...".
#
# If DATABASE_URL does not look like a Unix-socket URL (e.g. it's a TCP URL
# or we're in local dev), skip the wait and start immediately.

SOCKET_PATH=""
if [ -n "$DATABASE_URL" ]; then
  # Extract host= or cloudsql path from the URL.
  # Unix socket URLs look like: postgresql://user:pass@localhost/db?host=/cloudsql/proj:region:instance
  # Or the pg driver uses the value after "host=" in the query string.
  # Cloud Run injects the socket at: /cloudsql/<connection-name>/.s.PGSQL.5432
  case "$DATABASE_URL" in
    */cloudsql/*)
      # Pull the cloudsql instance path out of the connection string
      INSTANCE=$(echo "$DATABASE_URL" | sed -n 's|.*cloudsql/\([^/?&"]*\).*|\1|p' | head -1)
      if [ -n "$INSTANCE" ]; then
        SOCKET_PATH="/cloudsql/${INSTANCE}/.s.PGSQL.5432"
      fi
      ;;
  esac
fi

if [ -n "$SOCKET_PATH" ]; then
  echo "[start.sh] Waiting for Cloud SQL socket: $SOCKET_PATH"
  i=0
  while [ $i -lt 30 ]; do
    if [ -S "$SOCKET_PATH" ]; then
      echo "[start.sh] Socket ready after ${i}s"
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  if [ ! -S "$SOCKET_PATH" ]; then
    echo "[start.sh] WARNING: socket never appeared — starting anyway"
  fi
else
  echo "[start.sh] No Cloud SQL Unix socket detected — starting immediately"
fi

exec node server.js
