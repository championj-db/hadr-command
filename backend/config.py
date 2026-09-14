"""Central configuration — everything overridable by environment variable."""

import os

# Fully-qualified UC schema holding all HADR tables (flat layout).
SCHEMA = os.getenv("HADR_SCHEMA", "au_pubsec_catalog.hadr")

# Serverless SQL warehouse. Databricks Apps injects DATABRICKS_WAREHOUSE_ID when the
# warehouse is attached as an app resource; the literal is the au-pubsec default.
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "083bec41aa3ab495")

# Local development only — ignored inside Databricks Apps (ambient SP credentials win).
PROFILE = os.getenv("DATABRICKS_CONFIG_PROFILE")

# FMAPI chat endpoint for SITREP generation.
SITREP_ENDPOINT = os.getenv("HADR_SITREP_ENDPOINT", "databricks-claude-sonnet-4-6")

# Live pollers.
QLDTRAFFIC_URL = os.getenv(
    "HADR_QLDTRAFFIC_URL",
    "https://api.qldtraffic.qld.gov.au/v2/events?apikey=3e83add325cbb69ac4d8e5bf433d770b",
)
QLDTRAFFIC_INTERVAL_S = int(os.getenv("HADR_QLDTRAFFIC_INTERVAL_S", "300"))
BOM_FTP_HOST = "ftp.bom.gov.au"
BOM_RSS_URL = "http://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml"
BOM_INTERVAL_S = int(os.getenv("HADR_BOM_INTERVAL_S", "600"))
# FNQ local government areas the live road feed is filtered to.
FNQ_LGAS = {
    "cairns", "douglas", "mareeba", "tablelands", "cassowary coast",
    "yarrabah", "townsville", "hinchinbrook", "charters towers", "burdekin",
}

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
UI_DIST = os.getenv(
    "HADR_UI_DIST", os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
)

REPLAY_LAYERS = [
    "track", "cone", "wind", "rain", "flood", "roads",
    "warnings", "damage_delta", "readiness", "runways", "kpis",
]
