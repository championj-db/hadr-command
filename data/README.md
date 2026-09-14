# HADR COMMAND — Unity Catalog data layer

Data + ingestion/generation for the **HADR COMMAND** demo (TC Jasper, Dec 2023,
Cairns / Far North Queensland). Everything lives in a **single schema
`au_pubsec_catalog.hadr`** on the `au-pubsec` workspace, served by warehouse
`083bec41aa3ab495`. All tables use **flat names** (no per-domain sub-schemas); the
two live poller tables are name-prefixed `live_*`.

```
au_pubsec_catalog.hadr
├─ reference   airports, runways, aircraft_specs, defence_sites, buildings
├─ events      time_spine, cyclone_track, wind_field, rainfall_obs,
│              flood_extent, road_events_replay, warnings_replay
├─ live        live_qldtraffic_events, live_bom_warnings   (append-only, filled by backend pollers)
├─ analytics   building_damage_assessment, force_readiness, runway_status, layer_frames
└─ raw_files   (Volume) — parquet staging for loads
```

> **Note:** No dedicated `hadr` catalog is used — all objects are flat tables in
> `au_pubsec_catalog.hadr`. (A `hadr` catalog also can't be created bare here: the
> metastore has no default storage root, so `CREATE CATALOG` needs a MANAGED
> LOCATION.) The parquet-staging Volume is `au_pubsec_catalog.hadr.raw_files`.

The 4D replay runs on a **3-hourly UTC spine, 2023-12-05T00:00Z → 2023-12-18T21:00Z**
= **112 ticks** (`t_index` 0–111). Phases: `approach` → `landfall` → `flood` → `recovery`.
Tables store UTC; the UI shows AEST (UTC+10).

---

## Re-running everything

```bash
cd hadr-command
uv venv && source .venv/bin/activate
uv pip install databricks-sdk duckdb numpy pandas pyarrow shapely h3 Pillow requests

# 1. Schema / volume / empty tables (idempotent)
python - <<'PY'
import data.db as db
body = "\n".join(l for l in open('sql/create_tables.sql') if not l.strip().startswith('--'))
for s in [s.strip() for s in body.split(';') if s.strip()]:
    db.sql(s)
PY

# 2. Real-data ingestion  (IBTrACS, Overture, OurAirports, seeds, terrain DEM cache)
python data/ingest_reference.py            # or --only seeds,airports,buildings,track,dem

# 3. Synthetic 4D replay + analytics + serving cache
python data/generate_synthetic.py
```

All loads are **idempotent** (`CREATE OR REPLACE` / `MERGE`); re-running rebuilds
tables in place with no duplication (seeded RNG `seed=42`, deterministic). Target is
overridable via env vars `HADR_PROFILE`, `HADR_WAREHOUSE_ID`, `HADR_CATALOG`
(default `au_pubsec_catalog`), `HADR_SCHEMA` (default `hadr`) — see `data/db.py`.
`db.fq(domain, table)` resolves to `au_pubsec_catalog.hadr.<table>` (and
`live_<table>` when domain is `"live"`); the `domain` arg is descriptive only.

Loading strategy: anything non-trivial is written to a local parquet, uploaded to
the `au_pubsec_catalog.hadr.raw_files` **Volume**, then materialized via
`CREATE OR REPLACE TABLE … AS SELECT … FROM read_files(...)` (`db.load_table`).
The terrarium DEM is cached locally at `data/cache/dem_cairns.npz` (no UC table).

---

## Table catalog (verified row counts)

All tables are in `au_pubsec_catalog.hadr` (flat names shown below).

| Table | Rows | Notes |
|---|---:|---|
| `defence_sites` | 8 | Curated ADF estate (`data/seed/defence_sites.csv`). `on_map=false` for off-map staging (Amberley). |
| `aircraft_specs` | 5 | C-27J/C-130J/C-17A/KC-30A/MRH-90 planning figures (`data/seed/aircraft_specs.csv`). |
| `airports` | 4 | YBCS Cairns, YBTL Townsville, YBSG Scherger, YBMK Mackay (OurAirports). |
| `runways` | 7 | Runways for the above (OurAirports). |
| `buildings` | 70,419 | Overture footprints, Cairns bbox 145.60–145.90 / −17.10–−16.70. `geometry_wkt`, `height_m` (synthesized where null), `h3_r8`/`h3_r10`, `elevation_m` (DEM). |
| `time_spine` | 112 | `t_index`, `ts_utc`, `ts_aest`, `phase`, `narrative`. |
| `cyclone_track` | 106 | IBTrACS best track (SID `2023337S08165`), Dec 4–17. Peak **Cat 5 / 115 kt / 926 hPa**. RMW + R34/R50/R64 quadrant radii are **synthesized** (IBTrACS has none for this SH storm — see below). |
| `wind_field` | 48,600 | Holland-model wind at H3 r7 cells over FNQ, per tick, cells ≥20 kt only. Populated on 20 storm-active ticks (peak ~5,700 cells at landfall, max gust 75 kt). |
| `rainfall_obs` | 1,120 | 10 real FNQ stations × 112 ticks; ramps to published totals (Myola ~2,025 mm). |
| `flood_extent` | 112 | One inundation MultiPolygon per tick (DEM priority-flood). Peak area **91 km²** at t=100. |
| `road_events_replay` | 13 | FNQ segment closures (Flooding / Landslip / Hazard), QLDTraffic-shaped. |
| `warnings_replay` | 11 | Reconstructed BOM warning sequence (TC Watch → Warning → Severe Weather → Flood, escalating to Record Barron). |
| `building_damage_assessment` | 63,085 | Per-tick rows for the **4,636** damaged buildings (from onset → end). Monotonic class; `assessed` flag trails onset (rolling rapid-damage sweep). |
| `force_readiness` | 896 | 8 ADF units × 112 ticks (readiness %, posture, assets JSON). |
| `runway_status` | 448 | 4 airports × 112. YBCS closed t=96–105 (Dec 17 10:00 → Dec 18 13:00 AEST), limited t=106–109; YBTL open throughout (staging-base story). |
| `layer_frames` | 1,232 | **THE SERVING CACHE** — 11 layers × 112 ticks. See shapes below. |
| `live_qldtraffic_events` | 0 | Filled at runtime by the backend QLDTraffic poller. |
| `live_bom_warnings` | 0 | Filled at runtime by the backend BOM poller. |

---

## `layer_frames` — the serving cache (READ THIS, backend)

One row per `(layer, t_index)`: columns `layer`, `t_index`, `ts_utc`,
`payload_json`. The backend loads all 1,232 rows at startup and returns
`payload_json` **verbatim** per `(layer, t_index)` request — slider scrub is a
dict lookup, no warehouse round-trip. Coordinates are `[lon, lat]` (GeoJSON order).

The 11 layers and their exact payload shapes:

**`track`** — cyclone track so far + current position + forecast cone
```json
{
  "track_so_far": [[lon, lat], ...],          // all fixes up to this tick + current pos
  "current": {"lat": -15.9, "lon": 145.4, "category": 2, "max_wind_kt": 50, "rmw_km": 40.0},
  "cone": [[lon, lat], ...]                     // closed ring of the forecast uncertainty cone (may be null near end)
}
```

**`cone`** — forecast uncertainty cone as a standalone closed ring (same ring as `track.cone`)
```json
{"ring": [[lon, lat], ...] }                    // null if no forward track remains
```

**`wind`** — H3 r7 cells with wind ≥20 kt (empty list off-storm)
```json
{"cells": [{"h3": "87be...ffff", "gust_kt": 73.0, "mean_kt": 52.1}, ...]}
```

**`rain`** — active rainfall stations this tick
```json
{"stations": [{"station": "Myola", "lat": -16.828, "lon": 145.62, "rain_3h_mm": 30.1, "rain_cum_mm": 1874.1}, ...]}
```

**`flood`** — inundation polygon for this tick
```json
{"water_level_m": 7.5, "area_km2": 91.15, "geojson": {"type": "MultiPolygon", "coordinates": [...]}}
```

**`roads`** — road closures active this tick
```json
{"events": [{"event_id": "R15", "road_name": "Captain Cook Hwy", "segment_desc": "Machans Beach turnoff",
             "lat": -16.868, "lon": 145.745, "event_type": "Flooding|Landslip|Hazard",
             "impact_type": "Road closed", "status": "active"}, ...]}
```

**`warnings`** — BOM warnings active this tick
```json
{"warnings": [{"warning_id": "W08", "category": "Flood Warning", "severity": "Record",
               "headline": "...", "area_desc": "Barron River lower reaches"}, ...]}
```

**`damage_delta`** — building damage *changes since previous tick* + running counts
```json
{
  "changes": {"<building_id>": "minor|moderate|severe|destroyed", ...},   // only buildings whose class changed this tick
  "counts":  {"none": 65783, "minor": 0, "moderate": 2103, "severe": 1620, "destroyed": 913},
  "cumulative_damaged": 4636
}
```
> Apply deltas cumulatively from t=0 to reconstruct full per-building state at any
> tick without shipping 70k rows per frame. `building_id` joins `buildings`
> for footprint (`geometry_wkt`) + `height_m` (extruded PolygonLayer).

**`readiness`** — all 8 units this tick
```json
{"units": [{"unit_id": "HMAS_CAIRNS", "unit_name": "HMAS Cairns", "branch": "Navy",
            "site_id": "HMAS_CAIRNS", "readiness_pct": 0.92, "posture": "surge",
            "assets": {"boats": {"available": 6, "tasked": 5}, "landing_craft": {"available": 2, "tasked": 2}}}, ...]}
```

**`runways`** — all 4 airports this tick
```json
{"airports": [{"airport_ident": "YBCS", "status": "open|limited|closed", "reason": "...",
               "usable_by": ["C-27J", "C-130J", "C-17A", "KC-30A", "MRH-90"],
               "crosswind_kt": 5.0, "gust_kt": 8.4}, ...]}
```

**`kpis`** — the right-panel KPI strip
```json
{"ts_utc": "2023-12-17T12:00:00+00:00", "phase": "flood", "pop_affected": 11126,
 "roads_cut": 10, "runways_open": 3, "buildings_damaged": 4636,
 "units_ready": 8, "active_warnings": 4, "water_level_m": 7.5}
```

---

## Query examples

```sql
-- All layers for a given tick (what the frame endpoint returns)
SELECT layer, payload_json
FROM au_pubsec_catalog.hadr.layer_frames
WHERE t_index = 100;

-- Timeline for the scrubber
SELECT t_index, ts_aest, phase, narrative FROM au_pubsec_catalog.hadr.time_spine ORDER BY t_index;

-- Runway go/no-go matrix at flood peak (airport click card)
SELECT r.airport_ident, r.status, r.usable_by, r.crosswind_kt
FROM au_pubsec_catalog.hadr.runway_status r WHERE r.t_index = 100;

-- Damaged-building footprints for extrusion at a tick
SELECT b.building_id, b.geometry_wkt, b.height_m, d.damage_class, d.flood_depth_m
FROM au_pubsec_catalog.hadr.building_damage_assessment d
JOIN au_pubsec_catalog.hadr.buildings b USING (building_id)
WHERE d.t_index = 104;

-- Force readiness panel at a tick
SELECT unit_name, readiness_pct, posture, assets_json
FROM au_pubsec_catalog.hadr.force_readiness WHERE t_index = 100 ORDER BY readiness_pct DESC;

-- Aircraft suitability join (usable runways for the C-17A)
SELECT a.aircraft_type, r.airport_ident, r.length_m
FROM au_pubsec_catalog.hadr.aircraft_specs a
JOIN au_pubsec_catalog.hadr.runways r ON r.length_m >= a.min_runway_m
WHERE a.aircraft_type = 'C-17A';
```

---

## Data provenance & modelling notes

- **IBTrACS (real):** SID `2023337S08165`. TC Jasper is a Southern-Hemisphere storm
  reported by **BOM** — the USA/JTWC columns and **all wind-radii + RMW columns are
  empty**. Track lat/lon, wind (BOM_WIND, kt), pressure, storm speed/direction are
  real; **RMW and R34/R50/R64 quadrant radii are synthesized** from a Willoughby-style
  RMW fit + the Holland profile (clearly commented in `ingest_reference.py`).
- **Overture buildings (real):** release `2026-06-17.0` (latest per STAC), `geometry`
  is native GEOMETRY (CRS84). Heights: real where present, else `num_floors*3.2`,
  else uniform 4–6 m (seeded).
- **OurAirports (real).** **AWS terrarium DEM (real)** at z=12 for the Cairns bbox.
- **Flood is synthetic** — no real Jasper flood-extent product exists (no Copernicus
  EMS activation). Priority-flood (minimax connectivity) from the Barron mouth /
  coastal seed; inundated **land only** is shown (ocean + river channels, encoded ~0 m
  in terrarium, are the seed and excluded). Peak water surface **+7.5 m** anchors to
  the Barron's *record gauge* levels (terrarium is a surface model reading the flat
  delta at ~3–9 m, so this is a gauge-referenced anchor, not overland depth). It
  floods a faithful footprint — Cairns North/CBD, Portsmith, Machans/Barron delta,
  Aeroglen/Airport — and never touches the hillside western suburbs.
- **Wind / damage / readiness / runways / roads / rainfall / warnings** are all
  synthesized deterministically (seed=42); see `generate_synthetic.py` + `synth_lib.py`.

### Deviations from the plan
- **No `hadr` catalog / sub-schemas** — all tables are flat in `au_pubsec_catalog.hadr`;
  the two live tables are name-prefixed `live_qldtraffic_events` / `live_bom_warnings`
  (`live` is also a UC-reserved schema name).
- `cyclone_track` has **106 fixes** (full 3-hourly IBTrACS record Dec 4–17), not the
  "~40–60" estimate — it's the real cadence; the frontend filters by tick.
- Flood peak water surface is **+7.5 m** (Barron record-gauge anchor), not +3.5 m —
  the +3.5 m in the plan floods almost nothing given terrarium's canopy-biased flat-
  plain elevations. See flood note above.
- `road_events_replay` = **13** closures (segments actually intersecting flood/wind/
  landslip zones), out of the 25 candidate segments.

### For the backend
- Serve `layer_frames.payload_json` verbatim; coordinates are `[lon, lat]`.
- `damage_delta` ships **deltas** — accumulate from t=0 for full state.
- `live_qldtraffic_events` / `live_bom_warnings` tables exist and are empty; pollers append snapshots there.
- H3 wind cells are r7 strings — resolve to hex geometry client-side (`h3` JS) or via
  `h3_cell_to_boundary` in SQL if you prefer server-side.
