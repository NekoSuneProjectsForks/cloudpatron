#!/bin/sh
set -eu

# Docker named/bind volumes are mounted after the image is built. A fresh
# /data volume is therefore normally owned by root even though the image layer
# was prepared for the node user. Repair ownership before dropping privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/legacy /data/payments
  chown -R node:node /data
  exec gosu node "$0" "$@"
fi

: "${CLOUDPATRON_HTTP_HOST:?CLOUDPATRON_HTTP_HOST must be set}"
: "${BRIDGE_API_TOKEN:?BRIDGE_API_TOKEN must be set}"
if [ "${#BRIDGE_API_TOKEN}" -lt 32 ]; then
  echo "BRIDGE_API_TOKEN must be 32+ characters" >&2
  exit 1
fi

# Verify the mounted data volume is writable after privileges are dropped.
for dir in /data/legacy /data/payments; do
  if [ ! -w "$dir" ]; then
    echo "Data directory is not writable by node: $dir" >&2
    exit 1
  fi
done

node /app/payment-bridge/server.mjs &
bridge_pid=$!
go_pid=""

cleanup() {
  kill "$bridge_pid" 2>/dev/null || true
  if [ -n "$go_pid" ]; then kill "$go_pid" 2>/dev/null || true; fi
  wait "$bridge_pid" 2>/dev/null || true
  if [ -n "$go_pid" ]; then wait "$go_pid" 2>/dev/null || true; fi
}
trap cleanup INT TERM EXIT

# Do not expose the Go website until the private payment bridge is ready.
ready=0
for i in $(seq 1 20); do
  if node -e "fetch('http://127.0.0.1:8091/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$bridge_pid" 2>/dev/null; then break; fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "Payment bridge failed health check" >&2
  exit 1
fi

/usr/local/bin/cloudpatron --letsencrypt=false --http-addr=:8080 --http-host="${CLOUDPATRON_HTTP_HOST}" --datadir=/data/legacy &
go_pid=$!

while kill -0 "$bridge_pid" 2>/dev/null && kill -0 "$go_pid" 2>/dev/null; do
  sleep 2
done

echo "CloudPatron or payment bridge exited; shutting down" >&2
exit 1
