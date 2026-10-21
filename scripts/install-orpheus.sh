#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime="${RUNTIME_DIR:-$PWD/.runtime}"
mkdir -p "$runtime"
checkout() {
  local url="$1" target="$2" revision="$3"
  if [ ! -d "$target/.git" ]; then git clone "$url" "$target"; fi
  if [ -n "$(git -C "$target" status --porcelain --untracked-files=no)" ]; then
    echo "Refusing to overwrite modified checkout: $target" >&2; exit 1
  fi
  if [ "$(git -C "$target" rev-parse HEAD)" != "$revision" ]; then
    git -C "$target" fetch origin "$revision"
    git -C "$target" checkout --detach "$revision"
  fi
}
checkout https://github.com/OrfiTeam/OrpheusDL.git "$runtime/orpheusdl" a45ff47913508d4c09971bdb847d5845984f1e64
checkout https://github.com/yarrm80s/orpheusdl-qobuz.git "$runtime/orpheusdl/modules/qobuz" 6dc5c7e2bd9820a6a80b9ba4d3004fbdc6955e44
python3 -m venv "$runtime/venv"
"$runtime/venv/bin/python" -m pip install -r requirements-orpheus.lock
# Generate configuration without logging in or contacting Qobuz.
(cd "$runtime/orpheusdl" && "$runtime/venv/bin/python" orpheus.py settings refresh)
test -f "$runtime/orpheusdl/config/settings.json"
echo 'OrpheusDL + Qobuz installed. Configure .env before downloading.'
