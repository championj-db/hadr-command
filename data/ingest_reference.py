"""HADR COMMAND — real-data ingestion into the `hadr` Unity Catalog.

Populates reference + the raw cyclone track:
  reference.defence_sites   (seed CSV)
  reference.aircraft_specs  (seed CSV)
  reference.airports        (OurAirports, FNQ subset)
  reference.runways         (OurAirports, FNQ subset)
  reference.buildings       (Overture, Cairns bbox, + H3)
  events.cyclone_track      (IBTrACS best track for TC Jasper + synthesized radii)

Also caches a terrarium DEM grid for the Cairns bbox to data/cache/dem_cairns.npz
(used by generate_synthetic.py for flood-fill; no UC table).

Idempotent: every table is CREATE OR REPLACE. Re-running fully rebuilds.

Usage:
    python data/ingest_reference.py [--only seeds,airports,buildings,track,dem]
Requires: uv venv active with databricks-sdk duckdb numpy pandas pyarrow h3 Pillow requests
"""
from __future__ import annotations

import argparse
import io
import math
import os
import sys

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(__file__))
import db  # noqa: E402

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "seed")
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

# Cairns building bbox (per plan)
BLON_MIN, BLON_MAX = 145.60, 145.90
BLAT_MIN, BLAT_MAX = -17.10, -16.70

JASPER_SID = "2023337S08165"
OVERTURE_RELEASE = "2026-06-17.0"  # latest per STAC catalog (verified 2026-07-13)

# FNQ airport set
FNQ_AIRPORTS = {"YBCS", "YBTL", "YBSG", "YBMK"}

NM_TO_KM = 1.852


# ---------------------------------------------------------------------------
# Seeds
# ---------------------------------------------------------------------------
def ingest_seeds():
    sites = pd.read_csv(os.path.join(SEED, "defence_sites.csv"))
    sites["on_map"] = sites["on_map"].astype(bool)
    n = db.load_table(sites, "reference", "defence_sites")
    print(f"  reference.defence_sites: {n} rows")

    ac = pd.read_csv(os.path.join(SEED, "aircraft_specs.csv"))
    n = db.load_table(ac, "reference", "aircraft_specs")
    print(f"  reference.aircraft_specs: {n} rows")


# ---------------------------------------------------------------------------
# OurAirports
# ---------------------------------------------------------------------------
def ingest_airports():
    base = "https://davidmegginson.github.io/ourairports-data"
    ap = pd.read_csv(f"{base}/airports.csv")
    rw = pd.read_csv(f"{base}/runways.csv")

    ap = ap[ap["ident"].isin(FNQ_AIRPORTS)].copy()
    airports = pd.DataFrame({
        "ident": ap["ident"],
        "name": ap["name"],
        "iata_code": ap["iata_code"],
        "airport_type": ap["type"],
        "lat": ap["latitude_deg"].astype(float),
        "lon": ap["longitude_deg"].astype(float),
        "elevation_ft": ap["elevation_ft"].fillna(0).astype(int),
        "municipality": ap["municipality"],
    })
    n = db.load_table(airports, "reference", "airports")
    print(f"  reference.airports: {n} rows -> {list(airports['ident'])}")

    rw = rw[rw["airport_ident"].isin(FNQ_AIRPORTS)].copy()
    ft_to_m = 0.3048
    runways = pd.DataFrame({
        "airport_ident": rw["airport_ident"],
        "runway_name": rw["le_ident"].astype(str) + "/" + rw["he_ident"].astype(str),
        "length_m": (rw["length_ft"].fillna(0) * ft_to_m).round().astype(int),
        "width_m": (rw["width_ft"].fillna(0) * ft_to_m).round().astype(int),
        "surface": rw["surface"],
        "lighted": rw["lighted"].fillna(0).astype(bool),
        "le_ident": rw["le_ident"].astype(str),
        "he_ident": rw["he_ident"].astype(str),
        "le_heading_deg": rw["le_heading_degT"].astype(float),
    })
    n = db.load_table(runways, "reference", "runways")
    print(f"  reference.runways: {n} rows")


# ---------------------------------------------------------------------------
# Overture buildings via DuckDB
# ---------------------------------------------------------------------------
def ingest_buildings():
    import duckdb
    import h3

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE SECRET osm (TYPE s3, PROVIDER config, REGION 'us-west-2');")

    path = (f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}"
            f"/theme=buildings/type=building/*")
    # In this Overture release `geometry` is a native GEOMETRY (CRS84).
    q = f"""
    SELECT
      id,
      ST_AsText(geometry)              AS geometry_wkt,
      ST_Y(ST_Centroid(geometry))      AS lat,
      ST_X(ST_Centroid(geometry))      AS lon,
      height,
      num_floors,
      class,
      names.primary                    AS name
    FROM read_parquet('{path}', filename=false, hive_partitioning=1)
    WHERE bbox.xmin > {BLON_MIN} AND bbox.xmax < {BLON_MAX}
      AND bbox.ymin > {BLAT_MIN} AND bbox.ymax < {BLAT_MAX}
    """
    print("  querying Overture (this can take a minute)...")
    bdf = con.execute(q).fetch_df()
    print(f"  fetched {len(bdf)} buildings")

    rng = np.random.default_rng(42)
    # Synthesize height: real height -> num_floors*3.2 -> uniform 4..6 m
    h = bdf["height"].astype(float).to_numpy()
    nf = bdf["num_floors"].astype(float).to_numpy()
    syn = rng.uniform(4.0, 6.0, size=len(bdf))
    height_m = np.where(~np.isnan(h) & (h > 0), h,
                        np.where(~np.isnan(nf) & (nf > 0), nf * 3.2, syn))
    bdf["height_m"] = np.round(height_m, 2)
    bdf["num_floors"] = bdf["num_floors"].astype("Int64")

    # H3 indices from centroid
    lat = bdf["lat"].to_numpy()
    lon = bdf["lon"].to_numpy()
    bdf["h3_r8"] = [h3.latlng_to_cell(la, lo, 8) for la, lo in zip(lat, lon)]
    bdf["h3_r10"] = [h3.latlng_to_cell(la, lo, 10) for la, lo in zip(lat, lon)]
    bdf["elevation_m"] = np.nan  # filled by generate_synthetic from DEM

    out = pd.DataFrame({
        "building_id": bdf["id"].astype(str),
        "lat": bdf["lat"].astype(float),
        "lon": bdf["lon"].astype(float),
        "geometry_wkt": bdf["geometry_wkt"].astype(str),
        "height_m": bdf["height_m"].astype(float),
        "num_floors": bdf["num_floors"],
        "building_class": bdf["class"].astype(str),
        "name": bdf["name"],
        "h3_r8": bdf["h3_r8"],
        "h3_r10": bdf["h3_r10"],
        "elevation_m": bdf["elevation_m"].astype(float),
    })
    # num_floors as nullable int -> object with None for parquet friendliness
    out["num_floors"] = out["num_floors"].astype("Int64")
    n = db.load_table(out, "reference", "buildings",
                      select_expr="* EXCEPT(num_floors), CAST(num_floors AS INT) AS num_floors")
    print(f"  reference.buildings: {n} rows")


# ---------------------------------------------------------------------------
# IBTrACS best track + synthesized radii
# ---------------------------------------------------------------------------
def _aus_category(vmax_kt: float) -> int:
    """Australian TC category from 10-min sustained wind (kt)."""
    if vmax_kt < 34:
        return 0
    if vmax_kt < 48:
        return 1
    if vmax_kt < 64:
        return 2
    if vmax_kt < 86:
        return 3
    if vmax_kt < 108:
        return 4
    return 5


def _rmw_km(vmax_kt: float, lat: float) -> float:
    """Radius of max wind (km). Willoughby et al. (2006) parametric fit.
    RMW = 46.4 * exp(-0.0155*Vmax + 0.0169*|lat|), Vmax in kt->converted."""
    vmax_ms = vmax_kt * 0.514444
    rmw = 46.4 * math.exp(-0.0155 * vmax_ms + 0.0169 * abs(lat))
    return float(max(15.0, min(90.0, rmw)))


def _wind_radii_km(vmax_kt: float, rmw_km: float, thresh_kt: float) -> float:
    """Radius (km) at which the Holland-like profile V(r)=Vmax*(Rmw/r)^0.6
    drops to `thresh_kt`. Returns 0 if Vmax below threshold."""
    if vmax_kt <= thresh_kt:
        return 0.0
    # V = Vmax*(Rmw/r)^0.6  =>  r = Rmw * (Vmax/V)^(1/0.6)
    r = rmw_km * (vmax_kt / thresh_kt) ** (1.0 / 0.6)
    return float(min(r, 400.0))


def ingest_track():
    cache = os.path.join(CACHE, "ibtracs_jasper.csv")
    if not os.path.exists(cache):
        url = ("https://www.ncei.noaa.gov/data/"
               "international-best-track-archive-for-climate-stewardship-ibtracs/"
               "v04r01/access/csv/ibtracs.last3years.list.v04r01.csv")
        print("  downloading IBTrACS...")
        txt = requests.get(url, timeout=180).text
        lines = txt.splitlines()
        hdr, units = lines[0], lines[1]
        jasper = [l for l in lines[2:] if l.split(",")[0] == JASPER_SID]
        with open(cache, "w") as f:
            f.write("\n".join([hdr, units] + jasper) + "\n")

    # skip the units row (row index 1)
    raw = pd.read_csv(cache, skiprows=[1], keep_default_na=False, low_memory=False)
    raw = raw.replace(r"^\s*$", np.nan, regex=True)

    df = pd.DataFrame()
    df["ts_utc"] = pd.to_datetime(raw["ISO_TIME"])
    df["lat"] = raw["LAT"].astype(float)
    df["lon"] = raw["LON"].astype(float)
    # BOM is the reporting agency for Jasper (USA cols empty); fall back to WMO
    wind = raw["BOM_WIND"].astype(float)
    wind = wind.fillna(raw["WMO_WIND"].astype(float))
    pres = raw["BOM_PRES"].astype(float).fillna(raw["WMO_PRES"].astype(float))
    df["max_wind_kt"] = wind
    df["central_pressure_hpa"] = pres
    df["storm_dir_deg"] = raw["STORM_DIR"].astype(float)
    df["storm_speed_kt"] = raw["STORM_SPEED"].astype(float)

    # Keep the replay window Dec 4 -> Dec 18 (a little lead-in before the spine)
    df = df[(df["ts_utc"] >= "2023-12-04") & (df["ts_utc"] <= "2023-12-18 23:59")]
    df = df.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    # interpolate any missing wind/pres so the model always has values
    df["max_wind_kt"] = df["max_wind_kt"].interpolate().ffill().bfill()
    df["central_pressure_hpa"] = df["central_pressure_hpa"].interpolate().ffill().bfill()
    df["storm_dir_deg"] = df["storm_dir_deg"].interpolate().ffill().bfill()
    df["storm_speed_kt"] = df["storm_speed_kt"].interpolate().ffill().bfill()

    df["category"] = df["max_wind_kt"].apply(_aus_category).astype(int)
    df["rmw_km"] = [_rmw_km(v, la) for v, la in zip(df["max_wind_kt"], df["lat"])]

    # Synthesized quadrant radii (IBTrACS has none for Jasper). Symmetric base
    # from the wind profile, with a mild right-of-track (SE/SW in SH motion)
    # enlargement so the wind swath is realistically asymmetric.
    for thr, tag in [(34, "r34"), (50, "r50"), (64, "r64")]:
        base = np.array([_wind_radii_km(v, r, thr)
                         for v, r in zip(df["max_wind_kt"], df["rmw_km"])])
        # asymmetry factors NE, SE, SW, NW (SH storms: stronger left/poleward)
        df[f"{tag}_ne_km"] = np.round(base * 1.05, 1)
        df[f"{tag}_se_km"] = np.round(base * 1.15, 1)
        df[f"{tag}_sw_km"] = np.round(base * 1.00, 1)
        df[f"{tag}_nw_km"] = np.round(base * 0.85, 1)

    cols = ["ts_utc", "lat", "lon", "category", "max_wind_kt",
            "central_pressure_hpa", "rmw_km",
            "r34_ne_km", "r34_se_km", "r34_sw_km", "r34_nw_km",
            "r50_ne_km", "r50_se_km", "r50_sw_km", "r50_nw_km",
            "r64_ne_km", "r64_se_km", "r64_sw_km", "r64_nw_km",
            "storm_dir_deg", "storm_speed_kt"]
    df = df[cols]
    n = db.load_table(df, "events", "cyclone_track")
    print(f"  events.cyclone_track: {n} fixes "
          f"(peak {df['max_wind_kt'].max():.0f} kt, "
          f"cat {int(df['category'].max())})")


# ---------------------------------------------------------------------------
# Terrarium DEM cache (no UC table)
# ---------------------------------------------------------------------------
def _deg2tile(lat, lon, z):
    lat_r = math.radians(lat)
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def _tile2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def cache_dem(z=12):
    """Download terrarium tiles covering the Cairns bbox and assemble a DEM grid.
    Saves data/cache/dem_cairns.npz with arrays: elev, lats, lons."""
    from PIL import Image

    # Slightly wider than building bbox so flood fill has margin
    lat_min, lat_max = -17.15, -16.65
    lon_min, lon_max = 145.55, 145.95

    x0, y0 = _deg2tile(lat_max, lon_min, z)  # top-left
    x1, y1 = _deg2tile(lat_min, lon_max, z)  # bottom-right
    xs = range(min(x0, x1), max(x0, x1) + 1)
    ys = range(min(y0, y1), max(y0, y1) + 1)
    tiles_x, tiles_y = len(xs), len(ys)
    print(f"  DEM z={z}: {tiles_x}x{tiles_y} tiles")

    tile_px = 256
    grid = np.zeros((tiles_y * tile_px, tiles_x * tile_px), dtype=np.float32)
    sess = requests.Session()
    for iy, ty in enumerate(ys):
        for ix, tx in enumerate(xs):
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
            r = sess.get(url, timeout=60)
            r.raise_for_status()
            im = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB")).astype(np.float32)
            elev = im[:, :, 0] * 256.0 + im[:, :, 1] + im[:, :, 2] / 256.0 - 32768.0
            grid[iy * tile_px:(iy + 1) * tile_px, ix * tile_px:(ix + 1) * tile_px] = elev

    # Geo coordinates of the grid corners
    top_lat, left_lon = _tile2deg(min(xs), min(ys), z)
    bot_lat, right_lon = _tile2deg(max(xs) + 1, max(ys) + 1, z)
    # Note _tile2deg(x,y) returns the NW corner of that tile.
    nrows, ncols = grid.shape
    lats = np.linspace(top_lat, bot_lat, nrows)
    lons = np.linspace(left_lon, right_lon, ncols)

    out = os.path.join(CACHE, "dem_cairns.npz")
    np.savez_compressed(out, elev=grid, lats=lats, lons=lons, z=z)
    print(f"  saved {out}  grid={grid.shape}  "
          f"elev range {grid.min():.0f}..{grid.max():.0f} m")


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="seeds,airports,buildings,track,dem")
    args = ap.parse_args()
    steps = set(s.strip() for s in args.only.split(","))
    print(f"HADR ingest_reference (target={db.TARGET})")
    if "seeds" in steps:
        print("[seeds]"); ingest_seeds()
    if "airports" in steps:
        print("[airports]"); ingest_airports()
    if "buildings" in steps:
        print("[buildings]"); ingest_buildings()
    if "track" in steps:
        print("[track]"); ingest_track()
    if "dem" in steps:
        print("[dem]"); cache_dem()
    print("ingest_reference done.")


if __name__ == "__main__":
    main()
