"""HADR COMMAND — synthetic 4D replay + analytics generation.

Deterministic (seed=42), re-runnable. Reads reference.buildings + events.cyclone_track
from UC and the cached DEM, then produces:

  events.time_spine, events.wind_field, events.rainfall_obs, events.flood_extent,
  events.road_events_replay, events.warnings_replay,
  analytics.building_damage_assessment, analytics.force_readiness,
  analytics.runway_status, analytics.layer_frames  (+ updates reference.buildings.elevation_m)

All tables are CREATE OR REPLACE (idempotent). See data/README.md for the exact
layer_frames JSON shapes the backend serves verbatim.

Usage: python data/generate_synthetic.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import db  # noqa: E402
import synth_lib as sl  # noqa: E402

HERE = os.path.dirname(__file__)
CACHE = os.path.join(HERE, "cache")
SEED = 42
rng = np.random.default_rng(SEED)

# ---------------------------------------------------------------------------
# Time spine
# ---------------------------------------------------------------------------
START = datetime(2023, 12, 5, 0, 0, tzinfo=timezone.utc)
N_TICKS = 112
STEP_H = 3


def tick_ts(t):
    return START + timedelta(hours=STEP_H * t)


def dt(y, m, d, h):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


LANDFALL = dt(2023, 12, 13, 10)  # ~8pm AEST Dec 13 near Wujal Wujal
FLOOD_START = dt(2023, 12, 15, 12)
FLOOD_PEAK = dt(2023, 12, 17, 12)
FLOOD_PLATEAU_END = dt(2023, 12, 18, 0)
# Peak water-surface height (m above datum) at the Barron delta. Terrarium is a
# surface model that reads the flat coastal plain ~3-9 m, so this anchors to the
# Barron's RECORD gauge levels (Dec 2023) rather than overland depth; it floods a
# realistic footprint of the low delta suburbs (Machans/Holloways/Aeroglen/
# Cairns North/Portsmith) without touching the hillside western suburbs.
PEAK_WATER_M = 7.5


def phase_of(ts):
    if ts < dt(2023, 12, 13, 6):
        return "approach"
    if ts < dt(2023, 12, 14, 6):
        return "landfall"
    if ts < dt(2023, 12, 18, 0):
        return "flood"
    return "recovery"


def water_level(ts):
    """Barron-anchored water-surface height (m above datum)."""
    if ts < FLOOD_START:
        return 0.0
    if ts < FLOOD_PEAK:
        return PEAK_WATER_M * (ts - FLOOD_START) / (FLOOD_PEAK - FLOOD_START)
    if ts < FLOOD_PLATEAU_END:
        return PEAK_WATER_M
    # recede over 48h
    frac = (ts - FLOOD_PLATEAU_END).total_seconds() / (48 * 3600)
    return max(0.0, PEAK_WATER_M * (1 - frac))


# Key-tick narrative overrides; others filled by phase.
NARRATIVE = {}


def build_narrative(t, ts, phase, wl, cat):
    key = {
        dt(2023, 12, 5, 0): "TC Jasper monitored in the Coral Sea; BOM watching for FNQ impact.",
        dt(2023, 12, 6, 12): "Jasper intensifies to Category 5 offshore; tracking west toward the coast.",
        dt(2023, 12, 11, 0): "Cyclone Watch issued for the FNQ coast; ADF moves to warning posture.",
        dt(2023, 12, 13, 6): "Jasper nears the coast north of Cairns; destructive winds imminent.",
        dt(2023, 12, 13, 10): "LANDFALL near Wujal Wujal as a Category 2 system.",
        dt(2023, 12, 14, 6): "System weakens inland but stalls, dumping torrential rain over FNQ catchments.",
        dt(2023, 12, 15, 12): "Barron and Daintree rivers rising fast; flood warnings escalate.",
        dt(2023, 12, 16, 12): "Major flooding across Cairns northern beaches and the Barron delta.",
        dt(2023, 12, 17, 12): "RECORD Barron River flood peak; Cairns Airport inundated and closed.",
        dt(2023, 12, 18, 0): "Floodwaters begin to recede; rapid damage assessment and resupply underway.",
    }
    if ts in key:
        return key[ts]
    if phase == "approach":
        return f"Approach phase — Jasper Category {cat} tracking toward FNQ."
    if phase == "landfall":
        return "Landfall phase — destructive winds and heavy rain along the coast."
    if phase == "flood":
        return f"Flood phase — Barron water level +{wl:.1f} m; road and airport impacts."
    return "Recovery phase — floodwaters receding; sustainment and reconstruction."


# ---------------------------------------------------------------------------
# Reference stations, roads, warnings, units
# ---------------------------------------------------------------------------
# 10 real FNQ rainfall stations with published/representative event totals (mm)
STATIONS = [
    ("Myola", -16.828, 145.620, 2025),
    ("Kuranda", -16.820, 145.638, 1600),
    ("Cairns Airport", -16.876, 145.746, 680),
    ("Mossman", -16.462, 145.372, 1350),
    ("Daintree Village", -16.251, 145.316, 1500),
    ("Port Douglas", -16.484, 145.465, 900),
    ("Mareeba", -16.992, 145.419, 420),
    ("Copperlode Dam", -16.958, 145.688, 1450),
    ("Babinda", -17.342, 145.925, 1100),
    ("Innisfail", -17.523, 146.030, 850),
]

# ~25 real FNQ road segments (representative points along each)
ROADS = [
    ("R01", "Captain Cook Hwy", "Smithfield to Palm Cove", -16.813, 145.688),
    ("R02", "Captain Cook Hwy", "Ellis Beach / Rex Range base", -16.735, 145.660),
    ("R03", "Captain Cook Hwy", "Mowbray River bridge", -16.560, 145.520),
    ("R04", "Captain Cook Hwy", "Port Douglas turnoff", -16.510, 145.470),
    ("R05", "Kennedy Hwy", "Kuranda Range Rd", -16.847, 145.652),
    ("R06", "Kennedy Hwy", "Mareeba approach", -16.995, 145.430),
    ("R07", "Bruce Hwy", "Edmonton", -17.020, 145.744),
    ("R08", "Bruce Hwy", "Gordonvale (Mulgrave River)", -17.090, 145.786),
    ("R09", "Bruce Hwy", "Babinda", -17.342, 145.925),
    ("R10", "Bruce Hwy", "Innisfail (Johnstone River)", -17.523, 146.030),
    ("R11", "Mossman-Daintree Rd", "Daintree ferry approach", -16.300, 145.360),
    ("R12", "Gillies Range Rd", "Gillies Range switchbacks", -17.170, 145.640),
    ("R13", "Cairns Western Arterial", "Redlynch / Freshwater", -16.905, 145.700),
    ("R14", "Kamerunga Rd", "Barron River bridge Kamerunga", -16.868, 145.702),
    ("R15", "Captain Cook Hwy", "Machans Beach turnoff", -16.868, 145.745),
    ("R16", "Holloways Beach Access Rd", "Holloways Beach", -16.856, 145.755),
    ("R17", "Aeroglen / Airport Ave", "Cairns Airport access", -16.878, 145.752),
    ("R18", "Sheridan St", "Cairns North", -16.909, 145.767),
    ("R19", "Bruce Hwy", "Cairns to Edmonton floodway", -16.985, 145.740),
    ("R20", "Palmerston Hwy", "Innisfail to Millaa Millaa", -17.560, 145.870),
    ("R21", "Mulligan Hwy", "Mount Molloy", -16.680, 145.330),
    ("R22", "Captain Cook Hwy", "Yorkeys Knob turnoff", -16.815, 145.720),
    ("R23", "Barron Gorge Rd", "Barron Gorge", -16.855, 145.660),
    ("R24", "Reservoir Rd", "Manoora", -16.905, 145.735),
    ("R25", "Draper St", "Cairns CBD", -16.923, 145.770),
]

# BOM warning sequence (reconstructed). (id, product, category, severity, headline, area, issued, expiry)
WARNINGS = [
    ("W01", "Tropical Cyclone", "TC Watch", "Moderate",
     "Cyclone Watch: coastal area from Cape Flattery to Cairns", "Cape Flattery to Cairns",
     dt(2023, 12, 11, 0), dt(2023, 12, 12, 12)),
    ("W02", "Tropical Cyclone", "TC Warning", "Severe",
     "Cyclone Warning: Cooktown to Port Douglas, extending to Cairns", "Cooktown to Cairns",
     dt(2023, 12, 12, 6), dt(2023, 12, 14, 0)),
    ("W03", "Severe Weather", "Severe Weather", "Severe",
     "Severe Weather Warning: damaging winds and heavy rainfall, FNQ coast", "FNQ coast and ranges",
     dt(2023, 12, 12, 18), dt(2023, 12, 16, 0)),
    ("W04", "Tropical Cyclone", "TC Warning", "Severe",
     "Destructive winds near the centre at landfall near Wujal Wujal", "Wujal Wujal to Cape Tribulation",
     dt(2023, 12, 13, 6), dt(2023, 12, 13, 18)),
    ("W05", "Flood", "Flood Warning", "Minor",
     "Minor Flood Warning: Barron River", "Barron River catchment",
     dt(2023, 12, 14, 6), dt(2023, 12, 15, 6)),
    ("W06", "Flood", "Flood Warning", "Moderate",
     "Moderate Flood Warning: Barron and Mulgrave-Russell Rivers", "Barron / Mulgrave-Russell",
     dt(2023, 12, 15, 6), dt(2023, 12, 16, 6)),
    ("W07", "Flood", "Flood Warning", "Major",
     "Major Flood Warning: Barron River at Myola and Kamerunga", "Barron River",
     dt(2023, 12, 16, 0), dt(2023, 12, 18, 0)),
    ("W08", "Flood", "Flood Warning", "Record",
     "RECORD Major Flood Warning: Barron River — levels exceeding 1977 record", "Barron River lower reaches",
     dt(2023, 12, 16, 18), dt(2023, 12, 18, 12)),
    ("W09", "Flood", "Flood Warning", "Major",
     "Major Flood Warning: Daintree River", "Daintree River",
     dt(2023, 12, 15, 12), dt(2023, 12, 17, 18)),
    ("W10", "Severe Weather", "Severe Weather", "Moderate",
     "Severe Weather Warning: ongoing heavy rain and flash flooding, FNQ", "FNQ coast",
     dt(2023, 12, 16, 0), dt(2023, 12, 17, 18)),
    ("W11", "Flood", "Flood Watch", "Minor",
     "Flood Watch: FNQ coastal catchments as floodwaters recede", "FNQ coastal catchments",
     dt(2023, 12, 18, 0), dt(2023, 12, 18, 21)),
]

# 8 ADF units (unit_id, name, branch, site_id, base_readiness, assets, jtf_standup)
UNITS = [
    ("HMAS_CAIRNS", "HMAS Cairns", "Navy", "HMAS_CAIRNS", 0.90,
     {"boats": 6, "landing_craft": 2}, None),
    ("51_FNQR", "51st Bn Far North Queensland Regiment", "Army", "PORTON_BKS", 0.85,
     {"trucks": 12, "personnel_teams": 8}, None),
    ("3_CSSB", "3rd Combat Service Support Battalion", "Army", "LAVARACK_BKS", 0.92,
     {"trucks": 40, "water_purif": 6, "generators": 20}, None),
    ("5_AVN", "5th Aviation Regiment", "Army", "LAVARACK_BKS", 0.88,
     {"helicopters": 8}, None),
    ("27_SQN", "No. 27 Squadron RAAF", "Air Force", "RAAF_TOWNSVILLE", 0.90,
     {"ground_support_teams": 6}, None),
    ("35_SQN", "No. 35 Squadron RAAF (C-27J)", "Air Force", "RAAF_AMBERLEY", 0.93,
     {"c27j": 4}, None),
    ("36_SQN", "No. 36 Squadron RAAF (C-17A)", "Air Force", "RAAF_AMBERLEY", 0.95,
     {"c17a": 3}, None),
    ("JTF_664", "Joint Task Force 664 HQ", "Joint", "JTF664_HQ", 0.0,
     {"staff": 40}, dt(2023, 12, 14, 0)),
]

# DEM encodes ocean AND river channels as ~0 m; cells at/below this are water
# (used as flood seed + excluded from the displayed inundated-land polygon).
WATER_EL = 0.2

FNQ_BBOX = dict(lat_min=-18.5, lat_max=-15.5, lon_min=144.5, lon_max=147.5)

# Flood AOI (Cairns / Barron delta / northern beaches / southern suburbs)
AOI = dict(lat_min=-17.10, lat_max=-16.72, lon_min=145.66, lon_max=145.84)


# ---------------------------------------------------------------------------
# Load inputs
# ---------------------------------------------------------------------------
def load_track():
    rows = db.rows(
        "SELECT ts_utc, lat, lon, category, max_wind_kt, rmw_km, "
        "storm_dir_deg, storm_speed_kt, r34_ne_km, r34_se_km, r34_sw_km, r34_nw_km "
        f"FROM {db.fq('events','cyclone_track')} ORDER BY ts_utc")
    cols = ["ts_utc", "lat", "lon", "category", "max_wind_kt", "rmw_km",
            "storm_dir_deg", "storm_speed_kt", "r34_ne", "r34_se", "r34_sw", "r34_nw"]
    df = pd.DataFrame(rows, columns=cols)
    df["ts_utc"] = pd.to_datetime(df["ts_utc"], utc=True)
    for c in cols[1:]:
        df[c] = df[c].astype(float)
    return df


def interp_track(track):
    """Interpolate the best track to each 3-hourly tick. Returns dict of arrays."""
    # epoch seconds (robust to us/ns dtype resolution)
    tx = track["ts_utc"].map(lambda x: x.timestamp()).to_numpy()
    ticks_ts = np.array([tick_ts(t).timestamp() for t in range(N_TICKS)])
    out = {"ts": ticks_ts}
    for c in ["lat", "lon", "max_wind_kt", "rmw_km", "storm_speed_kt",
              "r34_ne", "r34_se", "r34_sw", "r34_nw"]:
        out[c] = np.interp(ticks_ts, tx, track[c].to_numpy())
    # direction: interpolate via unwrapped angle
    ang = np.radians(track["storm_dir_deg"].to_numpy())
    ux = np.interp(ticks_ts, tx, np.cos(ang))
    uy = np.interp(ticks_ts, tx, np.sin(ang))
    out["storm_dir_deg"] = (np.degrees(np.arctan2(uy, ux)) + 360) % 360
    # category from wind
    out["category"] = np.array([
        0 if v < 34 else 1 if v < 48 else 2 if v < 64 else 3 if v < 86 else 4 if v < 108 else 5
        for v in out["max_wind_kt"]])
    return out


def load_buildings():
    rows = db.rows(
        f"SELECT building_id, lat, lon, height_m FROM {db.fq('reference','buildings')}")
    df = pd.DataFrame(rows, columns=["building_id", "lat", "lon", "height_m"])
    df["lat"] = df["lat"].astype(float)
    df["lon"] = df["lon"].astype(float)
    df["height_m"] = df["height_m"].astype(float)
    return df


def load_dem():
    d = np.load(os.path.join(CACHE, "dem_cairns.npz"))
    return d["elev"].astype(np.float64), d["lats"], d["lons"]


def sample_grid(grid, glats, glons, lat, lon):
    """Nearest-cell sample from a grid with (possibly descending) lat coords."""
    if glats[0] > glats[-1]:
        iy = np.clip(np.searchsorted(-glats, -np.asarray(lat)), 0, len(glats) - 1)
    else:
        iy = np.clip(np.searchsorted(glats, np.asarray(lat)), 0, len(glats) - 1)
    ix = np.clip(np.searchsorted(glons, np.asarray(lon)), 0, len(glons) - 1)
    return grid[iy, ix]


# ---------------------------------------------------------------------------
# Flood model: build the priority-flood threshold grid over the Cairns AOI.
# ---------------------------------------------------------------------------
def build_flood_grid(elev, glats, glons, downsample=2):
    """Crop DEM to the AOI, downsample, and compute the flood-connectivity
    threshold grid seeded from the Barron mouth / coastal low ground."""
    # crop indices (lats descending)
    lat_desc = glats[0] > glats[-1]
    if lat_desc:
        iy = np.where((glats <= AOI["lat_max"]) & (glats >= AOI["lat_min"]))[0]
    else:
        iy = np.where((glats >= AOI["lat_min"]) & (glats <= AOI["lat_max"]))[0]
    ix = np.where((glons >= AOI["lon_min"]) & (glons <= AOI["lon_max"]))[0]
    sub = elev[np.ix_(iy, ix)]
    slats = glats[iy]
    slons = glons[ix]
    # downsample by block averaging
    d = downsample
    nr = (sub.shape[0] // d) * d
    nc = (sub.shape[1] // d) * d
    sub = sub[:nr, :nc].reshape(nr // d, d, nc // d, d).mean(axis=(1, 3))
    flats = slats[:nr:d]
    flons = slons[:nc:d]

    # Seed: coastal / river-mouth low ground in the northern Barron delta box.
    seed = np.zeros_like(sub, dtype=bool)
    # ocean & tidal (elev <= 0.2) anywhere in AOI acts as connected water body
    seed |= sub <= 0.2
    # explicit Barron mouth / Machans seed box
    mb_lat = (flats <= -16.83) & (flats >= -16.92)
    mb_lon = (flons >= 145.72) & (flons <= 145.78)
    box_mask = np.outer(mb_lat, mb_lon)
    seed |= box_mask & (sub <= 3.0)
    if not seed.any():
        seed |= sub <= (np.percentile(sub, 5))

    thresh = sl.priority_flood_threshold(sub, seed)
    return dict(elev=sub, lats=flats, lons=flons, thresh=thresh)


def km_offset(lat, lon, dnorth_km, deast_km):
    dlat = dnorth_km / 111.0
    dlon = deast_km / (111.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def forecast_cone(ti, t):
    """Build a forecast uncertainty cone (GeoJSON polygon coords) from the
    current position forward ~48h, half-width growing rmw -> 150 km."""
    end = min(N_TICKS - 1, t + 16)
    idx = list(range(t, end + 1))
    if len(idx) < 2:
        return None
    lats = ti["lat"][idx]; lons = ti["lon"][idx]
    n = len(idx)
    left = []; right = []
    for k in range(n):
        w = ti["rmw_km"][t] + (150.0 - ti["rmw_km"][t]) * (k / max(1, n - 1))
        # local heading
        if k < n - 1:
            hd = math.radians(sl.bearing_deg(lats[k], lons[k], lats[k + 1], lons[k + 1]))
        else:
            hd = math.radians(sl.bearing_deg(lats[k - 1], lons[k - 1], lats[k], lons[k]))
        # perpendicular offsets (left = -90deg, right = +90deg)
        for sign, acc in ((-1, left), (1, right)):
            bnorth = math.cos(hd + sign * math.pi / 2)
            beast = math.sin(hd + sign * math.pi / 2)
            la, lo = km_offset(lats[k], lons[k], w * bnorth, w * beast)
            acc.append([round(lo, 4), round(la, 4)])
    ring = left + right[::-1] + [left[0]]
    return ring


# ---------------------------------------------------------------------------
# Damage classification
# ---------------------------------------------------------------------------
CLASSES = ["none", "minor", "moderate", "severe", "destroyed"]
CIDX = {c: i for i, c in enumerate(CLASSES)}


def flood_class(depth):
    if depth <= 0.1:
        return 0
    if depth <= 0.3:
        return 1
    if depth <= 1.2:
        return 2
    if depth <= 2.5:
        return 3
    return 4


def generate():
    print(f"HADR generate_synthetic (target={db.TARGET})  seed={SEED}")
    track = load_track()
    ti = interp_track(track)
    bld = load_buildings()
    elev, glats, glons = load_dem()
    fg = build_flood_grid(elev, glats, glons)
    print(f"  track fixes={len(track)}  buildings={len(bld)}  "
          f"flood grid={fg['elev'].shape}")

    ts_list = [tick_ts(t) for t in range(N_TICKS)]
    wl_list = [water_level(t) for t in ts_list]
    phase_list = [phase_of(t) for t in ts_list]

    # ---- time_spine ----
    spine = pd.DataFrame({
        "t_index": range(N_TICKS),
        "ts_utc": pd.to_datetime([t for t in ts_list], utc=True),
        "ts_aest": pd.to_datetime([t + timedelta(hours=10) for t in ts_list]).tz_localize(None),
        "phase": phase_list,
        "narrative": [build_narrative(t, ts_list[t], phase_list[t], wl_list[t],
                                      int(ti["category"][t])) for t in range(N_TICKS)],
    })
    # ts_aest stored as naive local wall-clock (AEST) per convention
    n = db.load_table(spine, "events", "time_spine")
    print(f"  events.time_spine: {n}")

    # ---- building enrichment: elevation + flood threshold ----
    b_lat = bld["lat"].to_numpy(); b_lon = bld["lon"].to_numpy()
    b_elev = sample_grid(elev, glats, glons, b_lat, b_lon)
    # threshold: sample fg thresh; buildings outside AOI -> inf
    in_aoi = ((b_lat >= AOI["lat_min"]) & (b_lat <= AOI["lat_max"]) &
              (b_lon >= AOI["lon_min"]) & (b_lon <= AOI["lon_max"]))
    b_thresh = np.full(len(bld), np.inf)
    if in_aoi.any():
        b_thresh[in_aoi] = sample_grid(fg["thresh"], fg["lats"], fg["lons"],
                                       b_lat[in_aoi], b_lon[in_aoi])
    bld["elevation_m"] = np.round(b_elev, 1)
    # write elevation back to reference.buildings via temp + MERGE
    tmp = pd.DataFrame({"building_id": bld["building_id"], "elevation_m": bld["elevation_m"]})
    db.load_table(tmp, "reference", "bld_elev_tmp")
    db.sql(
        f"MERGE INTO {db.fq('reference','buildings')} t "
        f"USING {db.fq('reference','bld_elev_tmp')} s ON t.building_id = s.building_id "
        f"WHEN MATCHED THEN UPDATE SET t.elevation_m = s.elevation_m")
    db.sql(f"DROP TABLE IF EXISTS {db.fq('reference','bld_elev_tmp')}")
    print("  reference.buildings.elevation_m updated")

    # ---- wind field over H3 r7 cells ----
    import h3
    poly = h3.LatLngPoly([
        (FNQ_BBOX["lat_max"], FNQ_BBOX["lon_min"]),
        (FNQ_BBOX["lat_max"], FNQ_BBOX["lon_max"]),
        (FNQ_BBOX["lat_min"], FNQ_BBOX["lon_max"]),
        (FNQ_BBOX["lat_min"], FNQ_BBOX["lon_min"]),
    ])
    r7 = list(h3.polygon_to_cells(poly, 7))
    r7_ll = np.array([h3.cell_to_latlng(c) for c in r7])
    r7_lat = r7_ll[:, 0]; r7_lon = r7_ll[:, 1]
    print(f"  r7 cells={len(r7)}")

    wind_rows = []
    wind_frames = {}   # t -> list of {h3, gust_kt, mean_kt}
    for t in range(N_TICKS):
        quad = [ti["r34_ne"][t], ti["r34_se"][t], ti["r34_sw"][t], ti["r34_nw"][t]]
        mean, gust = sl.wind_gust_kt(
            r7_lat, r7_lon, ti["lat"][t], ti["lon"][t], ti["max_wind_kt"][t],
            ti["rmw_km"][t], ti["storm_dir_deg"][t], ti["storm_speed_kt"][t], quad)
        keep = np.where(mean >= 20.0)[0]
        frame = []
        for i in keep:
            wind_rows.append((t, r7[i], float(r7_lat[i]), float(r7_lon[i]),
                              round(float(mean[i]), 1), round(float(gust[i]), 1)))
            frame.append({"h3": r7[i], "gust_kt": round(float(gust[i]), 1),
                          "mean_kt": round(float(mean[i]), 1)})
        wind_frames[t] = frame
    wf = pd.DataFrame(wind_rows, columns=["t_index", "h3_r7", "lat", "lon",
                                          "mean_wind_kt", "gust_kt"])
    n = db.load_table(wf, "events", "wind_field")
    print(f"  events.wind_field: {n} rows (>=20kt cells)")

    # ---- per-tick building gust (running max) + flood depth -> damage ----
    run_gust = np.zeros(len(bld))
    cur_class = np.zeros(len(bld), dtype=int)
    cur_cause = np.array(["none"] * len(bld), dtype=object)
    onset = np.full(len(bld), -1, dtype=int)
    # seeded wind-damage draw per building
    u_wind = rng.random(len(bld))
    tall = bld["height_m"].to_numpy() > 8.0
    dmg_rows = []
    damage_deltas = {}   # t -> {building_id: class}
    cum_counts_by_t = []
    for t in range(N_TICKS):
        quad = [ti["r34_ne"][t], ti["r34_se"][t], ti["r34_sw"][t], ti["r34_nw"][t]]
        _, gust_b = sl.wind_gust_kt(
            b_lat, b_lon, ti["lat"][t], ti["lon"][t], ti["max_wind_kt"][t],
            ti["rmw_km"][t], ti["storm_dir_deg"][t], ti["storm_speed_kt"][t], quad)
        run_gust = np.maximum(run_gust, gust_b)
        wl = wl_list[t]
        b_elev_land = np.maximum(b_elev, 0.0)
        depth = np.where(b_thresh <= wl, np.maximum(0.0, wl - b_elev_land), 0.0)

        # wind class (probabilistic, sampled once via u_wind vs running p_wind)
        p_wind = sl.logistic((run_gust - 90.0) / 12.0)
        p_wind = np.where(tall, p_wind * 0.6, p_wind)
        wind_hit = u_wind < p_wind
        wind_cls = np.zeros(len(bld), dtype=int)
        wind_cls = np.where(wind_hit & (run_gust > 65), 1, wind_cls)
        wind_cls = np.where(wind_hit & (run_gust > 80), 2, wind_cls)
        wind_cls = np.where(wind_hit & (run_gust > 95), 3, wind_cls)
        wind_cls = np.where(wind_hit & (run_gust > 110), 4, wind_cls)
        fl_cls = np.array([flood_class(d) for d in depth])
        inst = np.maximum(wind_cls, fl_cls)
        newc = np.maximum(cur_class, inst)  # monotonic
        changed = np.where(newc != cur_class)[0]
        delta = {}
        for i in changed:
            cls_i = int(newc[i])
            cause = "flood" if fl_cls[i] >= wind_cls[i] and fl_cls[i] > 0 else "wind"
            if fl_cls[i] > 0 and wind_cls[i] > 0:
                cause = "wind+flood"
            cur_cause[i] = cause
            if onset[i] < 0:
                onset[i] = t
            delta[bld["building_id"].iat[i]] = CLASSES[cls_i]
        cur_class = newc
        damage_deltas[t] = delta
        counts = {c: int((cur_class == CIDX[c]).sum()) for c in CLASSES}
        cum_counts_by_t.append(counts)
        # record per-tick rows for currently-damaged buildings
        dmg_idx = np.where(cur_class > 0)[0]
        for i in dmg_idx:
            dmg_rows.append((t, bld["building_id"].iat[i], float(b_lat[i]), float(b_lon[i]),
                             round(float(run_gust[i]), 1), round(float(depth[i]), 2),
                             CLASSES[int(cur_class[i])], str(cur_cause[i])))

    # assessed flag: per damaged building assign assess tick Dec14(t=72)..Dec18(t=104)
    dmg_bids = np.where(cur_class > 0)[0]
    # closeness to Cairns CBD -> earlier assessment
    cbd_lat, cbd_lon = -16.92, 145.77
    dist_cbd = sl.haversine_km(cbd_lat, cbd_lon, b_lat, b_lon)
    assess_tick = np.full(len(bld), 999, dtype=int)
    if len(dmg_bids):
        dnorm = (dist_cbd[dmg_bids] - dist_cbd[dmg_bids].min()) / (
            np.ptp(dist_cbd[dmg_bids]) + 1e-6)
        jitter = rng.random(len(dmg_bids))
        # assessment TRAILS damage onset by 1..11 ticks (3-33h), later for less
        # accessible (further-from-CBD) sites -> a visible rolling assessment sweep
        lag = 1 + np.round(dnorm * 6 + jitter * 4).astype(int)
        at = np.minimum(onset[dmg_bids] + lag, N_TICKS - 1)
        assess_tick[dmg_bids] = at

    dmg_df = pd.DataFrame(dmg_rows, columns=[
        "t_index", "building_id", "lat", "lon", "max_gust_kt", "flood_depth_m",
        "damage_class", "cause"])
    # attach assessed (vectorized: map building_id -> assess tick, compare)
    bid_to_assess = dict(zip(bld["building_id"].to_numpy(), assess_tick))
    dmg_assess = dmg_df["building_id"].map(bid_to_assess).to_numpy()
    dmg_df["assessed"] = dmg_df["t_index"].to_numpy() >= dmg_assess
    n = db.load_table(dmg_df, "analytics", "building_damage_assessment")
    print(f"  analytics.building_damage_assessment: {n} rows "
          f"({len(dmg_bids)} buildings damaged)")

    # ---- flood extent polygons per tick ----
    flood_rows = []
    flood_frames = {}
    for t in range(N_TICKS):
        wl = wl_list[t]
        # inundated LAND only: connected (thresh<=wl), genuine land (el>WATER_EL),
        # and submerged (wl>el). Excludes the ocean/permanent river channels.
        mask = (fg["thresh"] <= wl) & (fg["elev"] > WATER_EL) & (wl > fg["elev"])
        geom = sl.mask_to_multipolygon(mask, fg["lats"], fg["lons"]) if wl > 0 else None
        if geom is None or geom.is_empty:
            gj = {"type": "MultiPolygon", "coordinates": []}
            area = 0.0
        else:
            gj = json.loads(__import__("shapely").to_geojson(geom))
            if gj["type"] == "Polygon":
                gj = {"type": "MultiPolygon", "coordinates": [gj["coordinates"]]}
            # area in km^2: approx via shapely area in deg^2 * (111km)^2*cos(lat)
            area = float(geom.area * 111.0 * 111.0 * math.cos(math.radians(-16.9)))
        flood_rows.append((t, round(wl, 2), json.dumps(gj), round(area, 2)))
        flood_frames[t] = {"water_level_m": round(wl, 2), "area_km2": round(area, 2),
                           "geojson": gj}
    flood_df = pd.DataFrame(flood_rows, columns=["t_index", "water_level_m",
                                                 "geojson", "area_km2"])
    n = db.load_table(flood_df, "events", "flood_extent")
    print(f"  events.flood_extent: {n} (peak area "
          f"{max(r[3] for r in flood_rows):.1f} km2)")

    # ---- rainfall ----
    rain_rows = []
    rain_frames = {t: [] for t in range(N_TICKS)}
    # temporal profile: rain concentrated Dec 12 -> Dec 18, peak Dec 15-17
    prof_center = [dt(2023, 12, 13, 0), dt(2023, 12, 17, 0)]
    for name, la, lo, total in STATIONS:
        # weight per tick using a broad gaussian-ish window over the event
        weights = np.zeros(N_TICKS)
        for t in range(N_TICKS):
            ts = ts_list[t]
            # active window Dec 11 -> Dec 18
            if ts < dt(2023, 12, 11, 0) or ts > dt(2023, 12, 18, 12):
                continue
            hrs_from_peak = abs((ts - dt(2023, 12, 15, 12)).total_seconds()) / 3600.0
            weights[t] = math.exp(-(hrs_from_peak / 55.0) ** 2)
        if weights.sum() == 0:
            weights[54] = 1.0
        weights = weights / weights.sum()
        cum = 0.0
        for t in range(N_TICKS):
            r3 = total * weights[t]
            cum += r3
            rain_rows.append((t, ts_list[t], name, la, lo, round(r3, 1), round(cum, 1)))
            if r3 > 0.05 or t == N_TICKS - 1:
                rain_frames[t].append({"station": name, "lat": la, "lon": lo,
                                       "rain_3h_mm": round(r3, 1),
                                       "rain_cum_mm": round(cum, 1)})
    rain_df = pd.DataFrame(rain_rows, columns=["t_index", "ts_utc", "station",
                                               "lat", "lon", "rain_3h_mm", "rain_cum_mm"])
    rain_df["ts_utc"] = pd.to_datetime(rain_df["ts_utc"], utc=True)
    n = db.load_table(rain_df, "events", "rainfall_obs")
    print(f"  events.rainfall_obs: {n} rows")

    # ---- roads: close on flood intersection, damaging wind, or (range roads)
    #      landslip risk during the heavy-rain window ----
    road_active = {}   # event_id -> list of active ticks
    road_cause = {}    # event_id -> cause at onset
    road_frames = {t: [] for t in range(N_TICKS)}
    r_lat = np.array([r[3] for r in ROADS]); r_lon = np.array([r[4] for r in ROADS])
    r_in_aoi = ((r_lat >= AOI["lat_min"]) & (r_lat <= AOI["lat_max"]) &
                (r_lon >= AOI["lon_min"]) & (r_lon <= AOI["lon_max"]))
    r_thresh = np.full(len(ROADS), np.inf)
    if r_in_aoi.any():
        r_thresh[r_in_aoi] = sample_grid(fg["thresh"], fg["lats"], fg["lons"],
                                         r_lat[r_in_aoi], r_lon[r_in_aoi])
    r_elev = sample_grid(elev, glats, glons, r_lat, r_lon)
    _RANGE_KW = ("Range", "Gorge", "Palmerston", "Kuranda", "Gillies", "Mulligan")
    is_range = np.array([any(k in (r[1] + " " + r[2]) for k in _RANGE_KW)
                         for r in ROADS])
    heavy_rain_start = dt(2023, 12, 13, 0)
    heavy_rain_end = dt(2023, 12, 18, 6)
    for t in range(N_TICKS):
        ts = ts_list[t]
        wl = wl_list[t]
        quad = [ti["r34_ne"][t], ti["r34_se"][t], ti["r34_sw"][t], ti["r34_nw"][t]]
        _, gust_r = sl.wind_gust_kt(
            r_lat, r_lon, ti["lat"][t], ti["lon"][t], ti["max_wind_kt"][t],
            ti["rmw_km"][t], ti["storm_dir_deg"][t], ti["storm_speed_kt"][t], quad)
        flooded = (r_thresh <= wl) & (wl - np.maximum(r_elev, 0.0) > 0.1)
        windy = gust_r > 50.0
        heavy = heavy_rain_start <= ts < heavy_rain_end
        landslip = is_range & heavy
        for i, road in enumerate(ROADS):
            if flooded[i] or windy[i] or landslip[i]:
                road_active.setdefault(road[0], []).append(t)
                if flooded[i]:
                    etype = "Flooding"
                elif landslip[i]:
                    etype = "Landslip"
                else:
                    etype = "Hazard"
                road_cause.setdefault(road[0], etype)
                road_frames[t].append({
                    "event_id": road[0], "road_name": road[1], "segment_desc": road[2],
                    "lat": road[3], "lon": road[4], "event_type": etype,
                    "impact_type": "Road closed", "status": "active"})
    road_rows = []
    for road in ROADS:
        ticks = road_active.get(road[0])
        if not ticks:
            continue
        t0, t1 = min(ticks), max(ticks)
        etype = road_cause.get(road[0], "Hazard")
        ts_end = None if t1 >= N_TICKS - 1 else ts_list[t1] + timedelta(hours=STEP_H)
        road_rows.append((road[0], road[1], road[2], road[3], road[4],
                          etype, "Road closed", ts_list[t0], ts_end))
    road_df = pd.DataFrame(road_rows, columns=[
        "event_id", "road_name", "segment_desc", "lat", "lon",
        "event_type", "impact_type", "ts_start", "ts_end"])
    for c in ["ts_start", "ts_end"]:
        road_df[c] = pd.to_datetime(road_df[c], utc=True)
    n = db.load_table(road_df, "events", "road_events_replay")
    print(f"  events.road_events_replay: {n} closures")

    # ---- warnings ----
    war_rows = []
    for w in WARNINGS:
        war_rows.append((w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7]))
    war_df = pd.DataFrame(war_rows, columns=[
        "warning_id", "product", "category", "severity", "headline", "area_desc",
        "ts_issued", "ts_expiry"])
    for c in ["ts_issued", "ts_expiry"]:
        war_df[c] = pd.to_datetime(war_df[c], utc=True)
    n = db.load_table(war_df, "events", "warnings_replay")
    print(f"  events.warnings_replay: {n}")
    warn_frames = {t: [] for t in range(N_TICKS)}
    for t in range(N_TICKS):
        ts = ts_list[t]
        for w in WARNINGS:
            if w[6] <= ts < w[7]:
                warn_frames[t].append({"warning_id": w[0], "category": w[2],
                                       "severity": w[3], "headline": w[4],
                                       "area_desc": w[5]})

    # ---- force readiness ----
    # site coords for local wind/flood penalties
    site_rows = db.rows(
        f"SELECT site_id, lat, lon FROM {db.fq('reference','defence_sites')}")
    site_ll = {r[0]: (float(r[1]), float(r[2])) for r in site_rows}
    rd_rows = []
    readiness_frames = {t: [] for t in range(N_TICKS)}
    for t in range(N_TICKS):
        ts = ts_list[t]
        quad = [ti["r34_ne"][t], ti["r34_se"][t], ti["r34_sw"][t], ti["r34_nw"][t]]
        for uid, uname, branch, site_id, base, assets, standup in UNITS:
            slat, slon = site_ll.get(site_id, (-19.0, 146.0))
            _, gust_s = sl.wind_gust_kt(
                np.array([slat]), np.array([slon]), ti["lat"][t], ti["lon"][t],
                ti["max_wind_kt"][t], ti["rmw_km"][t], ti["storm_dir_deg"][t],
                ti["storm_speed_kt"][t], quad)
            gust_s = float(gust_s[0])
            # posture
            if ts < dt(2023, 12, 11, 0):
                posture = "baseline"
            elif ts < dt(2023, 12, 14, 0):
                posture = "warning"
            elif ts < dt(2023, 12, 17, 0):
                posture = "response"
            else:
                posture = "surge"
            if standup is not None and ts < standup:
                rd = 0.0
                posture = "standing up"
                note = "Not yet stood up"
                assets_j = {k: {"available": 0, "tasked": 0} for k in assets}
            else:
                wind_pen = max(0.0, (gust_s - 40) / 100.0) * 0.5
                flood_pen = 0.05 if (site_id in ("HMAS_CAIRNS", "PORTON_BKS") and
                                     water_level(ts) > 1.5) else 0.0
                # tasking ramp after Dec 14 raises operational tempo
                ramp = 0.0
                if ts >= dt(2023, 12, 14, 0):
                    ramp = min(0.08, (ts - dt(2023, 12, 14, 0)).total_seconds() / 3600 / 96 * 0.08)
                base_now = base if base > 0 else 0.9
                rd = float(np.clip(base_now - wind_pen - flood_pen + ramp, 0.3, 1.0))
                # assets tasked ramps with posture
                task_frac = {"baseline": 0.0, "warning": 0.15, "response": 0.55,
                             "surge": 0.85, "standing up": 0.0}[posture]
                assets_j = {}
                for k, v in assets.items():
                    tasked = int(round(v * task_frac))
                    assets_j[k] = {"available": v, "tasked": tasked}
                note = f"{posture.title()} posture; local gust {gust_s:.0f} kt"
            rd_rows.append((t, uid, uname, branch, site_id, round(rd, 3),
                            posture, json.dumps(assets_j), note))
            readiness_frames[t].append({"unit_id": uid, "unit_name": uname,
                                        "branch": branch, "site_id": site_id,
                                        "readiness_pct": round(rd, 3),
                                        "posture": posture, "assets": assets_j})
    rd_df = pd.DataFrame(rd_rows, columns=[
        "t_index", "unit_id", "unit_name", "branch", "site_id", "readiness_pct",
        "posture", "assets_json", "note"])
    n = db.load_table(rd_df, "analytics", "force_readiness")
    print(f"  analytics.force_readiness: {n} rows")

    # ---- runway status ----
    ap_rows = db.rows(
        f"SELECT ident, lat, lon FROM {db.fq('reference','airports')}")
    ap_ll = {r[0]: (float(r[1]), float(r[2])) for r in ap_rows}
    rw_rows = db.rows(
        f"SELECT airport_ident, max(length_m) FROM {db.fq('reference','runways')} "
        f"GROUP BY airport_ident")
    rw_len = {r[0]: int(r[1]) for r in rw_rows}
    ac_rows = db.rows(
        f"SELECT aircraft_type, min_runway_m FROM {db.fq('reference','aircraft_specs')}")
    ac_min = {r[0]: int(r[1]) for r in ac_rows}

    def usable(length_m, limited=False):
        if limited:
            allow = {"C-27J", "C-130J", "MRH-90"}
            return [a for a, m in ac_min.items() if m <= length_m and a in allow]
        return [a for a, m in ac_min.items() if m <= length_m]

    rs_rows = []
    runway_frames = {t: [] for t in range(N_TICKS)}
    for t in range(N_TICKS):
        ts = ts_list[t]
        quad = [ti["r34_ne"][t], ti["r34_se"][t], ti["r34_sw"][t], ti["r34_nw"][t]]
        for ident, (alat, alon) in ap_ll.items():
            length_m = rw_len.get(ident, 2000)
            _, gust_a = sl.wind_gust_kt(
                np.array([alat]), np.array([alon]), ti["lat"][t], ti["lon"][t],
                ti["max_wind_kt"][t], ti["rmw_km"][t], ti["storm_dir_deg"][t],
                ti["storm_speed_kt"][t], quad)
            gust_a = float(gust_a[0])
            crosswind = round(gust_a * 0.6, 1)
            status, reason = "open", "Normal operations"
            if ident == "YBCS":
                if dt(2023, 12, 17, 0) <= ts < dt(2023, 12, 18, 6):
                    status, reason = "closed", "Runway inundated / flood + crosswind"
                elif dt(2023, 12, 18, 6) <= ts < dt(2023, 12, 18, 18):
                    status, reason = "limited", "Post-flood: tactical airlift only"
            # generic high-wind limitation
            if status == "open" and gust_a > 55:
                status, reason = "limited", f"High crosswind (gust {gust_a:.0f} kt)"
            if status == "open":
                ub = usable(length_m)
            elif status == "limited":
                ub = usable(length_m, limited=True)
            else:
                ub = []
            rs_rows.append((t, ident, status, reason, json.dumps(ub),
                            crosswind, round(gust_a, 1)))
            runway_frames[t].append({"airport_ident": ident, "status": status,
                                     "reason": reason, "usable_by": ub,
                                     "crosswind_kt": crosswind, "gust_kt": round(gust_a, 1)})
    rs_df = pd.DataFrame(rs_rows, columns=[
        "t_index", "airport_ident", "status", "reason", "usable_by",
        "crosswind_kt", "gust_kt"])
    n = db.load_table(rs_df, "analytics", "runway_status")
    print(f"  analytics.runway_status: {n} rows")

    # ---- track frames ----
    track_fix_epoch = track["ts_utc"].map(lambda x: x.timestamp()).to_numpy()
    track_frames = {}
    for t in range(N_TICKS):
        ts = ts_list[t]
        mask = track_fix_epoch <= ts.timestamp()
        sofar = [[round(float(track["lon"].iloc[i]), 4),
                  round(float(track["lat"].iloc[i]), 4)]
                 for i in range(len(track)) if mask[i]]
        # include current interpolated position
        sofar.append([round(float(ti["lon"][t]), 4), round(float(ti["lat"][t]), 4)])
        cone = forecast_cone(ti, t)
        track_frames[t] = {
            "track_so_far": sofar,
            "current": {"lat": round(float(ti["lat"][t]), 4),
                        "lon": round(float(ti["lon"][t]), 4),
                        "category": int(ti["category"][t]),
                        "max_wind_kt": round(float(ti["max_wind_kt"][t]), 0),
                        "rmw_km": round(float(ti["rmw_km"][t]), 1)},
            "cone": cone,
        }

    # ---- KPIs + assemble layer_frames ----
    frame_rows = []

    def add_frame(layer, t, payload):
        frame_rows.append((layer, t, ts_list[t], json.dumps(payload)))

    for t in range(N_TICKS):
        add_frame("track", t, track_frames[t])
        add_frame("cone", t, {"ring": track_frames[t]["cone"]})
        add_frame("wind", t, {"cells": wind_frames[t]})
        add_frame("rain", t, {"stations": rain_frames[t]})
        add_frame("flood", t, flood_frames[t])
        add_frame("roads", t, {"events": road_frames[t]})
        add_frame("warnings", t, {"warnings": warn_frames[t]})
        add_frame("damage_delta", t, {
            "changes": damage_deltas[t],
            "counts": cum_counts_by_t[t],
            "cumulative_damaged": int(sum(v for k, v in cum_counts_by_t[t].items()
                                          if k != "none"))})
        add_frame("readiness", t, {"units": readiness_frames[t]})
        add_frame("runways", t, {"airports": runway_frames[t]})

        # KPIs
        roads_cut = len(road_frames[t])
        runways_open = sum(1 for a in runway_frames[t] if a["status"] == "open")
        dmg_cum = int(sum(v for k, v in cum_counts_by_t[t].items() if k != "none"))
        units_ready = sum(1 for u in readiness_frames[t] if u["readiness_pct"] >= 0.8)
        active_warn = len(warn_frames[t])
        pop_affected = int(cum_counts_by_t[t].get("moderate", 0) * 2.4 +
                           cum_counts_by_t[t].get("severe", 0) * 2.4 +
                           cum_counts_by_t[t].get("destroyed", 0) * 2.4 +
                           cum_counts_by_t[t].get("minor", 0) * 1.2)
        add_frame("kpis", t, {
            "ts_utc": ts_list[t].isoformat(),
            "phase": phase_list[t],
            "pop_affected": pop_affected,
            "roads_cut": roads_cut,
            "runways_open": runways_open,
            "buildings_damaged": dmg_cum,
            "units_ready": units_ready,
            "active_warnings": active_warn,
            "water_level_m": round(wl_list[t], 2)})

    frames_df = pd.DataFrame(frame_rows, columns=["layer", "t_index", "ts_utc", "payload_json"])
    frames_df["ts_utc"] = pd.to_datetime(frames_df["ts_utc"], utc=True)
    n = db.load_table(frames_df, "analytics", "layer_frames")
    print(f"  analytics.layer_frames: {n} rows "
          f"({frames_df['layer'].nunique()} layers x {N_TICKS} ticks)")
    print("generate_synthetic done.")


if __name__ == "__main__":
    generate()
