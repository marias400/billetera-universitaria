#!/bin/zsh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
if [[ -x "$PROJECT_DIR/../.tools/node/bin/node" ]]; then
  exec "$PROJECT_DIR/../.tools/node/bin/node" scripts/iniciar-demo.mjs
fi
exec node scripts/iniciar-demo.mjs
