#!/usr/bin/env python3
"""Deploy-time export of building footprints to backend/static/buildings.geojson.gz.
Run from hadr-command/ with the venv active:  python scripts/export_buildings.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABRICKS_CONFIG_PROFILE", "au-pubsec")

from backend import config
from backend.buildings_export import export

out = os.path.join(config.STATIC_DIR, "buildings.geojson.gz")
os.makedirs(config.STATIC_DIR, exist_ok=True)
export(out)
print(f"wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)")
