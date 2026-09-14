"""Physics/geometry helpers for HADR synthetic generation.

Kept separate from generate_synthetic.py so the model functions are easy to
read and unit-test. All winds in knots, distances in km, angles in degrees.
"""
from __future__ import annotations

import heapq
import math

import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union

EARTH_R_KM = 6371.0


# ---------------------------------------------------------------------------
# Geodesy (vectorized)
# ---------------------------------------------------------------------------
def haversine_km(lat1, lon1, lat2, lon2):
    lat1 = np.radians(lat1); lon1 = np.radians(lon1)
    lat2 = np.radians(lat2); lon2 = np.radians(lon2)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2, degrees clockwise from north."""
    lat1 = np.radians(lat1); lat2 = np.radians(lat2)
    dlon = np.radians(lon2 - lon1)
    y = np.sin(dlon) * np.cos(lat2)
    x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
    return (np.degrees(np.arctan2(y, x)) + 360) % 360


# ---------------------------------------------------------------------------
# Holland-style wind field (Southern Hemisphere)
# ---------------------------------------------------------------------------
def wind_gust_kt(pts_lat, pts_lon, cx_lat, cx_lon, vmax_kt, rmw_km,
                 storm_dir_deg, storm_speed_kt,
                 r34_quad=None):
    """Vectorized mean-wind + gust (kt) at points for one cyclone fix.

    V(r) = Vmax*(Rmw/r)^0.6 outside RMW; linear rise inside RMW.
    +0.5*storm_speed asymmetry added on the LEFT of the motion vector (SH).
    gust = 1.4 * mean. Optionally clip using per-quadrant R34 so that beyond
    the quadrant's 34-kt radius the field is trimmed (avoids over-wide swaths).
    Returns (mean_kt, gust_kt) arrays.
    """
    pts_lat = np.asarray(pts_lat, dtype=float)
    pts_lon = np.asarray(pts_lon, dtype=float)
    r = haversine_km(cx_lat, cx_lon, pts_lat, pts_lon)
    r = np.maximum(r, 1.0)

    # Radial profile
    inside = r <= rmw_km
    mean = np.where(
        inside,
        vmax_kt * (r / rmw_km),
        vmax_kt * (rmw_km / r) ** 0.6,
    )

    # Motion asymmetry: add on the left of the track (SH strong side).
    brg = bearing_deg(cx_lat, cx_lon, pts_lat, pts_lon)
    # Angle of point relative to motion direction, signed [-180,180].
    rel = ((brg - storm_dir_deg + 180) % 360) - 180
    # Left of motion => rel < 0 (motion dir is "up"; left is negative bearing)
    left_weight = np.clip(-np.sin(np.radians(rel)), 0, 1)  # 1 fully left, 0 right
    mean = mean + 0.5 * storm_speed_kt * left_weight

    # Optional quadrant R34 clip
    if r34_quad is not None:
        # quadrant index by bearing: NE,SE,SW,NW
        q = np.zeros_like(r, dtype=int)
        q = np.where((brg >= 0) & (brg < 90), 0, q)
        q = np.where((brg >= 90) & (brg < 180), 1, q)
        q = np.where((brg >= 180) & (brg < 270), 2, q)
        q = np.where((brg >= 270), 3, q)
        rq = np.array(r34_quad)[q]
        # beyond 1.4x the quadrant R34, force below 20 kt (taper)
        far = r > (1.4 * np.maximum(rq, 1.0))
        mean = np.where(far & (rq > 0), np.minimum(mean, 15.0), mean)

    mean = np.maximum(mean, 0.0)
    return mean, mean * 1.4


# ---------------------------------------------------------------------------
# Priority-flood: minimax path elevation from seed cells (Barnes 2014 style).
# ---------------------------------------------------------------------------
def priority_flood_threshold(elev, seed_mask):
    """For each cell return the flood threshold = min over all paths from any
    seed cell of the maximum elevation along the path. A cell is flooded at
    water level W (and hydraulically connected to a seed) iff threshold <= W.

    elev: 2D float array. seed_mask: 2D bool array (True = seed).
    Returns 2D float array of thresholds (inf where unreachable).
    """
    nrows, ncols = elev.shape
    INF = math.inf
    thresh = np.full((nrows, ncols), INF, dtype=np.float64)
    visited = np.zeros((nrows, ncols), dtype=bool)
    heap = []
    seeds = np.argwhere(seed_mask)
    for i, j in seeds:
        t = float(elev[i, j])
        if t < thresh[i, j]:
            thresh[i, j] = t
            heapq.heappush(heap, (t, int(i), int(j)))

    while heap:
        t, i, j = heapq.heappop(heap)
        if visited[i, j]:
            continue
        visited[i, j] = True
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < nrows and 0 <= nj < ncols and not visited[ni, nj]:
                # threshold to reach neighbour = max(path so far, neighbour elev)
                nt = t if elev[ni, nj] <= t else float(elev[ni, nj])
                if nt < thresh[ni, nj]:
                    thresh[ni, nj] = nt
                    heapq.heappush(heap, (nt, ni, nj))
    return thresh


def mask_to_multipolygon(mask, lats, lons, simplify_deg=0.0004, min_area_deg2=1e-6):
    """Convert a boolean grid mask into a shapely (Multi)Polygon in lon/lat.

    Merges masked cells into horizontal runs (boxes) then unions — far cheaper
    than unioning every cell. lats/lons are 1-D cell-center coordinate arrays.
    """
    if not mask.any():
        return None
    # cell half-sizes
    dlat = abs(lats[1] - lats[0]) / 2 if len(lats) > 1 else 0.0005
    dlon = abs(lons[1] - lons[0]) / 2 if len(lons) > 1 else 0.0005
    boxes = []
    nrows = mask.shape[0]
    for i in range(nrows):
        row = mask[i]
        if not row.any():
            continue
        j = 0
        ncols = len(row)
        while j < ncols:
            if row[j]:
                k = j
                while k + 1 < ncols and row[k + 1]:
                    k += 1
                lon_lo = lons[j] - dlon
                lon_hi = lons[k] + dlon
                lat_c = lats[i]
                boxes.append(box(lon_lo, lat_c - dlat, lon_hi, lat_c + dlat))
                j = k + 1
            else:
                j += 1
    if not boxes:
        return None
    geom = unary_union(boxes)
    if simplify_deg:
        geom = geom.simplify(simplify_deg, preserve_topology=True)
    # drop tiny slivers
    if geom.geom_type == "Polygon":
        return geom if geom.area >= min_area_deg2 else geom
    return geom


def logistic(x):
    return 1.0 / (1.0 + np.exp(-x))
