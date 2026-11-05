#!/bin/sh
set -eu
: "${CLOUDPATRON_HTTP_HOST:?CLOUDPATRON_HTTP_HOST must be set}"
: "${BRIDGE_API_TOKEN:?BRIDGE_API_TOKEN must be set}"
if [ "${#BRIDGE_API_TOKEN}" -lt 32 ]; then echo "BRIDGE_API_TOKEN must be 32+ characters" >&2; exit 1; fi
mkdir -p /data/legacy /data/payments
node /app/payment-bridge/server.mjs &
bridge_pid=$!
/usr/local/bin/cloudpatron --letsencrypt=false --http-addr=:8080 --http-host="${CLOUDPATRON_HTTP_HOST}" --datadir=/data/legacy &
go_pid=$!
trap 'kill "$bridge_pid" "$go_pid" 2>/dev/null || true; wait "$bridge_pid" "$go_pid" 2>/dev/null || true' INT TERM EXIT
# Both services are required. Stop the container if either fails.
while kill -0 "$bridge_pid" 2>/dev/null && kill -0 "$go_pid" 2>/dev/null; do sleep 2; done
echo "CloudPatron or payment bridge exited; shutting down" >&2
exit 1
