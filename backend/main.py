"""HADR COMMAND — FastAPI backend.

Serves the built React UI plus /api: replay frames (from the in-memory cache),
reference data, live-mode state (pollers), and AI SITREP generation.
"""

import asyncio
import gzip
import logging
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, dbx, frames, pollers, sitrep

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("hadr")

app = FastAPI(title="HADR COMMAND", version="0.1.0")


@app.on_event("startup")
async def startup() -> None:
    frames.load_in_background()
    pollers.start(asyncio.get_running_loop())


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/api/status")
def status() -> dict:
    return {
        "frames_ready": frames.ready(),
        "frames_error": frames.error(),
        "frames_loaded": len(frames.frames),
        "live_roads_fetched_at": pollers.live_state["roads"]["fetched_at"],
        "live_warnings_fetched_at": pollers.live_state["warnings"]["fetched_at"],
        "schema": config.SCHEMA,
    }


def _require_ready() -> None:
    if not frames.ready():
        detail = frames.error() or "replay cache still loading"
        raise HTTPException(status_code=503, detail=detail)


@app.get("/api/timeline")
def timeline() -> list[dict]:
    _require_ready()
    return frames.timeline


@app.get("/api/frame/{t_index}")
def frame(t_index: int, layers: str = Query(default=",".join(config.REPLAY_LAYERS))) -> Response:
    """All requested layers at one tick. payload_json is returned verbatim."""
    _require_ready()
    if not 0 <= t_index < len(frames.timeline):
        raise HTTPException(status_code=404, detail="t_index out of range")
    requested = [l for l in layers.split(",") if l in config.REPLAY_LAYERS]
    parts = [
        f'"{layer}": {frames.get_frame(layer, t_index) or "null"}' for layer in requested
    ]
    body = '{"t_index": %d, %s}' % (t_index, ", ".join(parts))
    return Response(content=body, media_type="application/json")


@app.get("/api/frames/{layer}")
def all_frames(layer: str) -> Response:
    """Every tick for one layer — the UI preloads damage_delta and kpis this way."""
    _require_ready()
    if layer not in config.REPLAY_LAYERS:
        raise HTTPException(status_code=404, detail="unknown layer")
    parts = [
        f'"{t}": {frames.get_frame(layer, t) or "null"}' for t in range(len(frames.timeline))
    ]
    return Response(content="{%s}" % ", ".join(parts), media_type="application/json")


@app.get("/api/reference/{name}")
def reference(name: str) -> JSONResponse:
    _require_ready()
    if name not in frames.reference:
        raise HTTPException(status_code=404, detail="unknown reference table")
    return JSONResponse(frames.reference[name])


@app.get("/api/reference/buildings/geojson")
def buildings_geojson() -> Response:
    """Static pre-exported footprints (scripts/export_buildings.py). ~70k features,
    shipped gzipped; built at deploy time, or on demand into /tmp as a fallback."""
    path = os.path.join(config.STATIC_DIR, "buildings.geojson.gz")
    if not os.path.exists(path):
        path = "/tmp/hadr_buildings.geojson.gz"
        if not os.path.exists(path):
            _export_buildings_to(path)
    return FileResponse(
        path,
        media_type="application/geo+json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=86400"},
    )


def _export_buildings_to(path: str) -> None:
    from .buildings_export import export  # local import: shapely only needed here

    export(path)


@app.get("/api/live/state")
def live_state() -> dict:
    return {
        "roads": pollers.live_state["roads"],
        "warnings": pollers.live_state["warnings"],
    }


class SitrepRequest(BaseModel):
    t_index: int | None = None
    live: bool = False


@app.post("/api/sitrep")
def generate_sitrep(req: SitrepRequest) -> dict:
    if not req.live:
        _require_ready()
    try:
        return sitrep.generate(t_index=req.t_index, live=req.live)
    except Exception as e:
        log.exception("sitrep generation failed")
        raise HTTPException(status_code=502, detail=f"SITREP generation failed: {e}")


# Serve the built UI last so /api keeps precedence.
if os.path.isdir(config.UI_DIST):
    app.mount("/", StaticFiles(directory=config.UI_DIST, html=True), name="ui")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("DATABRICKS_APP_PORT", os.environ.get("PORT", "8000"))),
    )
