"""Live-mode pollers: QLDTraffic road events + BOM warnings.

Each poller keeps its latest snapshot in memory (instant reads for /api/live/state)
and appends to the UC live_* tables best-effort — a warehouse hiccup never breaks
live mode. BOM HTTP blocks non-browser user agents, so the RSS fetch sends a browser
UA and falls back to the sanctioned anonymous FTP listing.
"""

import asyncio
import datetime as dt
import ftplib
import io
import json
import logging
import xml.etree.ElementTree as ET

import httpx

from . import config, dbx

log = logging.getLogger(__name__)

live_state: dict = {
    "roads": {"events": [], "fetched_at": None, "source": "QLDTraffic (live)"},
    "warnings": {"warnings": [], "fetched_at": None, "source": "BOM (live)"},
}

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


async def poll_qldtraffic() -> None:
    while True:
        try:
            async with httpx.AsyncClient(timeout=30, headers={"User-Agent": _BROWSER_UA}) as http:
                resp = await http.get(config.QLDTRAFFIC_URL)
                if resp.status_code == 429:
                    # Shared public key is rate-limited from cloud egress IPs; keep the
                    # last snapshot and back off rather than erroring.
                    wait = int(resp.headers.get("Retry-After", "0") or 0)
                    log.info("qldtraffic rate-limited (429); keeping last snapshot, retry-after=%s", wait)
                    await asyncio.sleep(max(wait, config.QLDTRAFFIC_INTERVAL_S))
                    continue
                resp.raise_for_status()
                fc = resp.json()
            events = []
            for f in fc.get("features", []):
                p = f.get("properties", {})
                road = p.get("road_summary", {}) or {}
                lga = (road.get("local_government_area") or "").lower()
                if not any(l in lga for l in config.FNQ_LGAS):
                    continue
                geom = f.get("geometry") or {}
                coords = _first_point(geom)
                events.append(
                    {
                        "event_id": str(p.get("id", f.get("id", ""))),
                        "event_type": p.get("event_type"),
                        "event_subtype": p.get("event_subtype"),
                        "impact_type": (p.get("impact", {}) or {}).get("impact_type"),
                        "road_name": road.get("road_name"),
                        "locality": road.get("locality"),
                        "lga": road.get("local_government_area"),
                        "lat": coords[1] if coords else None,
                        "lon": coords[0] if coords else None,
                        "status": p.get("status", "active"),
                    }
                )
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            live_state["roads"] = {"events": events, "fetched_at": now, "source": "QLDTraffic (live)"}
            log.info("qldtraffic poll: %d FNQ events", len(events))
            _append_uc(
                f"INSERT INTO {config.SCHEMA}.live_qldtraffic_events "
                "(snapshot_ts, event_id, event_type, impact_type, road_name, description, lat, lon, raw_json) "
                "VALUES "
                + ", ".join(
                    "(current_timestamp(), "
                    + ", ".join(_sql_lit(v) for v in (
                        e["event_id"], e["event_type"], e["impact_type"],
                        e["road_name"], f'{e.get("event_subtype") or ""} — {e.get("locality") or ""} ({e.get("lga") or ""})',
                        e["lat"], e["lon"], json.dumps(e),
                    ))
                    + ")"
                    for e in events[:100]
                )
                if events
                else None
            )
        except Exception:
            log.exception("qldtraffic poll failed")
        await asyncio.sleep(config.QLDTRAFFIC_INTERVAL_S)


async def poll_bom() -> None:
    while True:
        try:
            warnings = await asyncio.to_thread(_fetch_bom_warnings)
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            live_state["warnings"] = {"warnings": warnings, "fetched_at": now, "source": "BOM (live)"}
            log.info("bom poll: %d active QLD warnings", len(warnings))
            _append_uc(
                f"INSERT INTO {config.SCHEMA}.live_bom_warnings "
                "(snapshot_ts, product_id, title, issued_ts, text, raw) VALUES "
                + ", ".join(
                    "(current_timestamp(), "
                    + ", ".join(_sql_lit(v) for v in (
                        w.get("product_id"), w.get("headline"), None,
                        w.get("link"), json.dumps(w),
                    ))
                    + ")"
                    for w in warnings[:50]
                )
                if warnings
                else None
            )
        except Exception:
            log.exception("bom poll failed")
        await asyncio.sleep(config.BOM_INTERVAL_S)


def _fetch_bom_warnings() -> list[dict]:
    # Preferred: QLD warnings RSS over HTTP with a browser UA.
    try:
        resp = httpx.get(
            config.BOM_RSS_URL,
            headers={"User-Agent": _BROWSER_UA},
            timeout=20,
            follow_redirects=True,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        out = []
        for item in root.iter("item"):
            title = item.findtext("title") or ""
            link = item.findtext("link") or ""
            out.append(
                {
                    "product_id": link.rsplit("/", 1)[-1].split(".")[0] if link else None,
                    "headline": title,
                    "link": link,
                    "source": "rss",
                }
            )
        return out
    except Exception:
        log.info("BOM RSS unavailable, falling back to anonymous FTP")
    # Fallback: anonymous FTP directory of QLD warning products.
    ftp = ftplib.FTP(config.BOM_FTP_HOST, timeout=30)
    ftp.login()
    ftp.cwd("anon/gen/fwo")
    names = [n for n in ftp.nlst() if n.startswith("IDQ") and n.endswith(".amoc.xml")]
    out = []
    for name in names[:30]:
        buf = io.BytesIO()
        try:
            ftp.retrbinary(f"RETR {name}", buf.write)
            root = ET.fromstring(buf.getvalue())
            expiry = root.findtext(".//expiry-time-utc") or ""
            if expiry and expiry < dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
                continue  # expired product
            out.append(
                {
                    "product_id": name.split(".")[0],
                    "headline": (root.findtext(".//product-type") or "Warning")
                    + " — "
                    + (root.findtext(".//service") or "QLD"),
                    "expiry_utc": expiry,
                    "source": "ftp-amoc",
                }
            )
        except Exception:
            continue
    ftp.quit()
    return out


def _first_point(geom: dict):
    t, c = geom.get("type"), geom.get("coordinates")
    if not c:
        return None
    if t == "Point":
        return c
    if t in ("LineString", "MultiPoint"):
        return c[0]
    if t in ("MultiLineString", "Polygon"):
        return c[0][0]
    return None


def _sql_lit(v) -> str:
    """Literal builder for the best-effort live appends (values are from typed
    parsing above, not raw user input; single quotes escaped)."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _append_uc(sql: str | None) -> None:
    if not sql:
        return
    try:
        dbx.exec_dml(sql)
    except Exception as e:
        log.warning("live UC append skipped: %s", e)


def start(loop: asyncio.AbstractEventLoop) -> None:
    loop.create_task(poll_qldtraffic())
    loop.create_task(poll_bom())
