#!/usr/bin/env bash
set -euo pipefail
mkdir -p /data/orpheus-config
if [ ! -f /data/orpheus-config/settings.json ]; then
  cp -n /opt/runtime/config-defaults/* /data/orpheus-config/
fi
exec node /app/.output/server/index.mjs
