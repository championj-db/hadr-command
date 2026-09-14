"""Export reference buildings to a gzipped GeoJSON for the frontend's extruded
3D layer. Run at deploy time via scripts/export_buildings.py; also usable as a
runtime fallback. Coordinates rounded to 5 dp (~1 m) to keep the file small."""

import gzip
import json
import logging

from . import config, dbx

log = logging.getLogger(__name__)


def export(path: str) -> None:
    from shapely import wkt as shapely_wkt

    rows = dbx.query(
        f"SELECT building_id, geometry_wkt, height_m, building_class FROM {config.SCHEMA}.buildings"
    )
    features = []
    for r in rows:
        try:
            geom = shapely_wkt.loads(r["geometry_wkt"])
        except Exception:
            continue
        gj = json.loads(json.dumps(geom.__geo_interface__))
        _round_coords(gj)
        features.append(
            {
                "type": "Feature",
                "id": r["building_id"],
                "geometry": gj,
                "properties": {
                    "h": round(float(r["height_m"] or 4.0), 1),
                    "c": r.get("building_class"),
                },
            }
        )
    fc = {"type": "FeatureCollection", "features": features}
    with gzip.open(path, "wt", compresslevel=6) as f:
        json.dump(fc, f, separators=(",", ":"))
    log.info("exported %d building footprints to %s", len(features), path)


def _round_coords(geom: dict) -> None:
    def walk(c):
        if isinstance(c[0], (int, float)):
            c[0], c[1] = round(c[0], 5), round(c[1], 5)
        else:
            for x in c:
                walk(x)

    walk(geom["coordinates"])
