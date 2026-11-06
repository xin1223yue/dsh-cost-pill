#!/bin/sh
# Thin wrapper around install.mjs (macOS / Linux).
set -e
here=$(cd "$(dirname "$0")" && pwd)
command -v node >/dev/null 2>&1 || {
  echo "node was not found on PATH - dsh itself needs Node 20+." >&2
  exit 1
}
exec node "$here/install.mjs" "$@"
