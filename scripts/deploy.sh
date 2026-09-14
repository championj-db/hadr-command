#!/usr/bin/env bash
# Deploy HADR COMMAND to the au-pubsec workspace as a Databricks App.
# Usage: ./scripts/deploy.sh [app-name]
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${DATABRICKS_CONFIG_PROFILE:-au-pubsec}"
APP="${1:-hadr-command}"
ME=$(databricks current-user me -p "$PROFILE" --output json | python3 -c "import json,sys;print(json.load(sys.stdin)['userName'])")
SRC="/Workspace/Users/$ME/apps-src/$APP"

echo "==> Building UI"
(cd ui && bun install --silent && bun run build)

echo "==> Ensuring buildings static export exists"
[ -f backend/static/buildings.geojson.gz ] || (source .venv-app/bin/activate && python scripts/export_buildings.py)

echo "==> Creating app (no-op if it exists)"
databricks apps create "$APP" -p "$PROFILE" 2>/dev/null || true

echo "==> Syncing source to $SRC"
databricks sync . "$SRC" -p "$PROFILE" \
  --exclude '.venv*/**' --exclude 'ui/node_modules/**' --exclude 'ui/src/**' \
  --exclude 'ui/public/**' --exclude 'data/cache/**' --exclude '**/__pycache__/**' \
  --exclude 'docs/**' --exclude 'design/**' --exclude '.git/**' --full

echo "==> Deploying"
databricks apps deploy "$APP" --source-code-path "$SRC" -p "$PROFILE"

databricks apps get "$APP" -p "$PROFILE" --output json | python3 -c "import json,sys;d=json.load(sys.stdin);print('URL:',d['url']);print('SP client id:',d.get('service_principal_client_id'))"
