-- ============================================================================
-- HADR COMMAND — Unity Catalog data layer DDL
-- Scenario: TC Jasper, Dec 2023, Cairns / Far North Queensland
-- Target: profile au-pubsec, warehouse 083bec41aa3ab495
--
-- ALL tables live in a SINGLE schema `au_pubsec_catalog.hadr` with FLAT table
-- names (no per-domain sub-schemas / no dedicated `hadr` catalog). The two live
-- poller tables are name-prefixed `live_*`.
--
-- NOTE: The ingestion / synthetic-generation Python scripts create most tables
-- via CREATE OR REPLACE TABLE ... AS SELECT (from parquet on a Volume) so that
-- schemas match the DataFrames exactly and loads are idempotent. This file is
-- the authoritative column contract + it creates the schema, volume, and the
-- append-only `live_*` tables that the backend pollers write to.
-- Run order: this file first, then data/ingest_reference.py, then
-- data/generate_synthetic.py.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS au_pubsec_catalog.hadr
  COMMENT 'HADR COMMAND demo — TC Jasper / Cairns early-warning COP';

CREATE VOLUME IF NOT EXISTS au_pubsec_catalog.hadr.raw_files
  COMMENT 'Staging area for parquet loads (buildings, frames, etc.)';

-- ============================================================================
-- Reference data
-- ============================================================================

-- Hand-curated Defence estate (data/seed/defence_sites.csv)
CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.defence_sites (
  site_id    STRING,
  name       STRING,
  branch     STRING,   -- Navy / Army / Air Force / Joint / Health-Staging
  site_type  STRING,   -- Naval Base / Barracks / Air Base / Helipad / HQ ...
  lat        DOUBLE,
  lon        DOUBLE,
  on_map     BOOLEAN,  -- false = off-map strategic staging (e.g. Amberley)
  notes      STRING
) COMMENT 'ADF estate + staging sites relevant to FNQ HADR (curated seed)';

-- Hand-curated aircraft planning figures (data/seed/aircraft_specs.csv)
CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.aircraft_specs (
  aircraft_type   STRING,
  designation     STRING,
  role            STRING,
  min_runway_m    INT,
  max_payload_kg  INT,
  max_pax         INT,
  ferry_range_km  INT,
  cruise_speed_kt INT,
  notes           STRING
) COMMENT 'ADF airlift planning figures (public approximations)';

-- OurAirports subset (FNQ set)
CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.airports (
  ident       STRING,   -- ICAO e.g. YBCS
  name        STRING,
  iata_code   STRING,
  airport_type STRING,
  lat         DOUBLE,
  lon         DOUBLE,
  elevation_ft INT,
  municipality STRING
) COMMENT 'Cairns / Townsville / Scherger / Mackay airports (OurAirports)';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.runways (
  airport_ident STRING,
  runway_name   STRING,   -- e.g. 15/33
  length_m      INT,
  width_m       INT,
  surface       STRING,
  lighted       BOOLEAN,
  le_ident      STRING,
  he_ident      STRING,
  le_heading_deg DOUBLE
) COMMENT 'Runways for the FNQ airport set (OurAirports)';

-- Overture buildings (Cairns bbox). Loaded by ingest_reference.py.
CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.buildings (
  building_id STRING,    -- Overture id
  lat         DOUBLE,    -- centroid
  lon         DOUBLE,    -- centroid
  geometry_wkt STRING,   -- footprint polygon WKT (WGS84)
  height_m    DOUBLE,    -- real or synthesized
  num_floors  INT,
  building_class STRING,
  name        STRING,
  h3_r8       STRING,
  h3_r10      STRING,
  elevation_m DOUBLE     -- DEM ground elevation at centroid (added at synth time)
) COMMENT 'Overture building footprints, Cairns bbox, with H3 + terrain enrichment';

-- ============================================================================
-- 4D replay events
-- ============================================================================

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.time_spine (
  t_index   INT,        -- 0..111
  ts_utc    TIMESTAMP,  -- 3-hourly UTC tick
  ts_aest   TIMESTAMP,  -- UTC+10 (display)
  phase     STRING,     -- approach / landfall / flood / recovery
  narrative STRING      -- short per-tick narrative line
) COMMENT '3-hourly replay spine 2023-12-05T00Z .. 2023-12-18T21Z';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.cyclone_track (
  ts_utc        TIMESTAMP,
  lat           DOUBLE,
  lon           DOUBLE,
  category      INT,        -- Aus scale (approx, derived from wind)
  max_wind_kt   DOUBLE,     -- 10-min sustained (converted from IBTrACS)
  central_pressure_hpa DOUBLE,
  rmw_km        DOUBLE,     -- radius of max wind
  r34_ne_km DOUBLE, r34_se_km DOUBLE, r34_sw_km DOUBLE, r34_nw_km DOUBLE,
  r50_ne_km DOUBLE, r50_se_km DOUBLE, r50_sw_km DOUBLE, r50_nw_km DOUBLE,
  r64_ne_km DOUBLE, r64_se_km DOUBLE, r64_sw_km DOUBLE, r64_nw_km DOUBLE,
  storm_dir_deg   DOUBLE,
  storm_speed_kt  DOUBLE
) COMMENT 'IBTrACS TC Jasper best track (SID 2023337S08165), radii converted nmi->km';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.wind_field (
  t_index    INT,
  h3_r7      STRING,
  lat        DOUBLE,
  lon        DOUBLE,
  mean_wind_kt DOUBLE,
  gust_kt    DOUBLE
) COMMENT 'Holland-model wind at H3 r7 cells over FNQ, per tick (>=20 kt only)';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.rainfall_obs (
  t_index      INT,
  ts_utc       TIMESTAMP,
  station      STRING,
  lat          DOUBLE,
  lon          DOUBLE,
  rain_3h_mm   DOUBLE,   -- rainfall in the 3h ending at ts
  rain_cum_mm  DOUBLE    -- cumulative event total to date
) COMMENT 'Reconstructed 3-hourly rainfall for ~10 real FNQ stations';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.flood_extent (
  t_index       INT,
  water_level_m DOUBLE,       -- Barron-anchored water surface offset
  geojson       STRING,       -- MultiPolygon (WGS84) of inundation this tick
  area_km2      DOUBLE
) COMMENT 'DEM-synthesized flood inundation polygon per tick';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.road_events_replay (
  event_id     STRING,
  road_name    STRING,
  segment_desc STRING,
  lat          DOUBLE,
  lon          DOUBLE,
  event_type   STRING,   -- Flooding / Landslip / Hazard
  impact_type  STRING,   -- e.g. 'Road closed'
  ts_start     TIMESTAMP,
  ts_end       TIMESTAMP  -- null while still active at end of replay
) COMMENT 'QLDTraffic-shaped closures for real FNQ road segments';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.warnings_replay (
  warning_id  STRING,
  product     STRING,     -- BOM product family
  category    STRING,     -- TC Watch / TC Warning / Severe Weather / Flood
  severity    STRING,     -- Minor / Moderate / Major / Severe / Record
  headline    STRING,
  area_desc   STRING,
  ts_issued   TIMESTAMP,
  ts_expiry   TIMESTAMP
) COMMENT 'Reconstructed BOM warning sequence for TC Jasper';

-- ============================================================================
-- Live poller tables (append-only; written by backend pollers, best effort)
-- ============================================================================

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.live_qldtraffic_events (
  snapshot_ts  TIMESTAMP,
  event_id     STRING,
  event_type   STRING,
  impact_type  STRING,
  road_name    STRING,
  description  STRING,
  lat          DOUBLE,
  lon          DOUBLE,
  raw_json     STRING
) COMMENT 'Live QLDTraffic event snapshots (poller append)';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.live_bom_warnings (
  snapshot_ts  TIMESTAMP,
  product_id   STRING,
  title        STRING,
  issued_ts    TIMESTAMP,
  text         STRING,
  raw          STRING
) COMMENT 'Live BOM warning snapshots (poller append, best effort)';

-- ============================================================================
-- Analytics
-- ============================================================================

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.building_damage_assessment (
  t_index       INT,
  building_id   STRING,
  lat           DOUBLE,
  lon           DOUBLE,
  max_gust_kt   DOUBLE,
  flood_depth_m DOUBLE,
  damage_class  STRING,   -- none / minor / moderate / severe / destroyed
  cause         STRING,   -- wind / flood / wind+flood / none
  assessed      BOOLEAN   -- has a rapid damage assessment reached this bldg yet
) COMMENT 'Per-building progressive damage assessment across the replay';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.force_readiness (
  t_index       INT,
  unit_id       STRING,
  unit_name     STRING,
  branch        STRING,
  site_id       STRING,     -- FK to defence_sites
  readiness_pct DOUBLE,
  posture       STRING,     -- baseline / warning / response / surge
  assets_json   STRING,     -- {helicopters:{avail,tasked}, trucks:{...}, boats:{...}}
  note          STRING
) COMMENT '8 ADF units, readiness % + posture + assets per tick';

CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.runway_status (
  t_index       INT,
  airport_ident STRING,
  status        STRING,      -- open / limited / closed
  reason        STRING,
  usable_by     STRING,      -- JSON array of aircraft_type usable this tick
  crosswind_kt  DOUBLE,
  gust_kt       DOUBLE
) COMMENT 'Per-tick per-airport operating status + suitability';

-- THE SERVING CACHE: one row per (layer, t_index). Backend loads all rows at
-- startup and serves `payload_json` verbatim per frame request.
CREATE TABLE IF NOT EXISTS au_pubsec_catalog.hadr.layer_frames (
  layer        STRING,   -- track/cone/wind/rain/flood/roads/warnings/damage_delta/readiness/runways/kpis
  t_index      INT,
  ts_utc       TIMESTAMP,
  payload_json STRING    -- exact JSON/GeoJSON the API returns for this layer+tick
) COMMENT 'Precomputed per-layer-per-tick serving cache (n_layers x 112 rows)';
