# HADR COMMAND

Early-warning and disaster-response common operating picture (COP) demo for Australian
Defence, built on Databricks. Replays **TC Jasper (Dec 2023, Cairns/FNQ)** in 4D —
cyclone track, Holland-model wind field, DEM-derived flood evolution, building damage,
road closures, force readiness — with a **LIVE** toggle streaming real BOM warnings and
QLDTraffic road events, and an **AI SITREP** generator (Claude via FMAPI).

All source data is public: IBTrACS best track, Overture Maps buildings, OurAirports,
AWS terrain tiles, BOM anonymous FTP, QLDTraffic open API. Synthetic layers (damage,
readiness, flood) are deterministic (seed=42) and clearly labelled in `data/README.md`.

## Architecture

- **Data**: single UC schema `au_pubsec_catalog.hadr` (18 flat tables) on the
  `au-pubsec` workspace; serving cache `layer_frames` = 11 layers × 112 ticks of
  precomputed JSON. See `data/README.md` for shapes and re-run instructions.
- **Backend** (`backend/`): FastAPI. Loads `layer_frames` into memory at startup
  (scrubbing never hits the warehouse); async pollers for QLDTraffic (5 min) and BOM
  (10 min) with best-effort appends to `live_*` tables; `/api/sitrep` calls
  `databricks-claude-sonnet-4-6`.
- **Frontend** (`ui/`): Vite + React 19 + TS + Tailwind, deck.gl v9 over MapLibre
  (ESRI satellite basemap). Extruded Overture buildings colored by damage class,
  H3 wind cells, flood GeoJSON, animated track + forecast cone, time scrubber,
  REPLAY↔LIVE toggle, runway go/no-go click cards, SITREP drawer.

## Local development

```bash
# Backend (terminal 1)
uv venv .venv-app && source .venv-app/bin/activate && uv pip install -r requirements.txt
DATABRICKS_CONFIG_PROFILE=au-pubsec python -m backend.main

# Frontend (terminal 2) — proxies /api to :8000
cd ui && bun install && bun run dev
```

One-time: `python scripts/export_buildings.py` writes
`backend/static/buildings.geojson.gz` (70k footprints, ~4 MB).

## Deploy (Databricks Apps)

```bash
./scripts/deploy.sh            # build UI, sync source, deploy app 'hadr-command'
```

Post-create wiring (first deploy only):
1. Attach the SQL warehouse as an app resource named `sql-warehouse`
   (id `083bec41aa3ab495`, permission `CAN_USE`) — matches `app.yml`'s `valueFrom`.
2. Grant the app service principal: `USE CATALOG` on `au_pubsec_catalog`,
   `USE SCHEMA` + `SELECT` on `au_pubsec_catalog.hadr`, `MODIFY` on
   `live_qldtraffic_events` and `live_bom_warnings`, and `CAN_QUERY` on the
   `databricks-claude-sonnet-4-6` serving endpoint.

## Repo layout

```
app.yml, requirements.txt     Databricks Apps runtime
backend/                      FastAPI (config, dbx, frames, pollers, sitrep, main)
ui/                           React + deck.gl frontend
data/                         UC ingestion + synthetic generation (see data/README.md)
sql/create_tables.sql         DDL
scripts/                      deploy.sh, export_buildings.py
design/claude_design_prompt.md  UI design brief for Claude Design
docs/                         demo script + screenshots
```
