"""Replay frame cache.

Loads the precomputed serving cache (`layer_frames`: 11 layers x 112 ticks) plus the
time spine and small reference tables into memory once, in a background thread at
startup. Scrubbing the timeline never touches the warehouse.
"""

import json
import logging
import threading

from . import config, dbx

log = logging.getLogger(__name__)

S = config.SCHEMA

_ready = threading.Event()
_error: str | None = None

frames: dict[tuple[str, int], str] = {}  # (layer, t_index) -> payload_json (verbatim)
timeline: list[dict] = []
reference: dict[str, list[dict]] = {}


def ready() -> bool:
    return _ready.is_set()


def error() -> str | None:
    return _error


def get_frame(layer: str, t_index: int) -> str | None:
    return frames.get((layer, t_index))


def load() -> None:
    global _error
    try:
        rows = dbx.query(f"SELECT layer, t_index, payload_json FROM {S}.layer_frames")
        for r in rows:
            frames[(r["layer"], int(r["t_index"]))] = r["payload_json"]
        log.info("loaded %d layer frames", len(rows))

        spine = dbx.query(
            f"SELECT t_index, ts_utc, ts_aest, phase, narrative FROM {S}.time_spine ORDER BY t_index"
        )
        for r in spine:
            r["t_index"] = int(r["t_index"])
        timeline.extend(spine)

        reference["defence_sites"] = dbx.query(f"SELECT * FROM {S}.defence_sites")
        reference["airports"] = dbx.query(f"SELECT * FROM {S}.airports")
        reference["runways"] = dbx.query(f"SELECT * FROM {S}.runways")
        reference["aircraft_specs"] = dbx.query(f"SELECT * FROM {S}.aircraft_specs")
        log.info("loaded reference tables")
        _ready.set()
    except Exception as e:  # surfaced via /api/status
        _error = str(e)
        log.exception("frame cache load failed")


def load_in_background() -> None:
    threading.Thread(target=load, name="frame-loader", daemon=True).start()


def frame_state(t_index: int, layers: list[str]) -> dict:
    """Parsed multi-layer state at a tick (used by the SITREP composer)."""
    out = {}
    for layer in layers:
        raw = get_frame(layer, t_index)
        out[layer] = json.loads(raw) if raw else None
    return out
