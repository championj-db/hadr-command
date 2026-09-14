"""Shared Databricks SQL execution helpers for the HADR data layer.

All scripts import from here so the warehouse / profile / catalog resolution
lives in one place. Uses the Statement Execution API via the Databricks SDK.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import time
import uuid

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    StatementState,
    Disposition,
    Format,
)

PROFILE = os.environ.get("HADR_PROFILE", "au-pubsec")
WAREHOUSE_ID = os.environ.get("HADR_WAREHOUSE_ID", "083bec41aa3ab495")

# All tables live in a SINGLE schema `au_pubsec_catalog.hadr` with FLAT table
# names (no per-domain sub-schemas). The logical "schema" arg to fq() below is
# kept only for call-site readability; it does not affect the physical location
# except for the two live tables, which are name-prefixed `live_*`.
CATALOG = os.environ.get("HADR_CATALOG", "au_pubsec_catalog")
SCHEMA = os.environ.get("HADR_SCHEMA", "hadr")
TARGET = f"{CATALOG}.{SCHEMA}"


def fq(schema_name: str, table: str) -> str:
    """Fully-qualified table name in the single au_pubsec_catalog.hadr schema.

    The logical `schema_name` is descriptive only; live tables become live_<table>.
    """
    name = f"live_{table}" if schema_name == "live" else table
    return f"{TARGET}.{name}"


_client: WorkspaceClient | None = None


def client() -> WorkspaceClient:
    global _client
    if _client is None:
        _client = WorkspaceClient(profile=PROFILE)
    return _client


def sql(statement: str, wait_timeout: str = "50s", catalog: str | None = None):
    """Execute a single SQL statement and return the result object.

    Raises RuntimeError on failure with the full error message.
    """
    w = client()
    resp = w.statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        statement=statement,
        wait_timeout=wait_timeout,
        disposition=Disposition.INLINE,
        format=Format.JSON_ARRAY,
        catalog=catalog,
    )
    # Poll until finished if still pending.
    statement_id = resp.statement_id
    while resp.status and resp.status.state in (
        StatementState.PENDING,
        StatementState.RUNNING,
    ):
        time.sleep(1)
        resp = w.statement_execution.get_statement(statement_id)

    state = resp.status.state if resp.status else None
    if state != StatementState.SUCCEEDED:
        err = ""
        if resp.status and resp.status.error:
            err = f"{resp.status.error.error_code}: {resp.status.error.message}"
        raise RuntimeError(f"SQL failed ({state}): {err}\n---\n{statement[:2000]}")
    return resp


def rows(statement: str, **kw):
    """Execute and return list of row arrays (JSON_ARRAY disposition)."""
    resp = sql(statement, **kw)
    if resp.result and resp.result.data_array:
        return resp.result.data_array
    return []


def scalar(statement: str, **kw):
    r = rows(statement, **kw)
    if r and r[0]:
        return r[0][0]
    return None


def volume_path(subdir: str = "") -> str:
    """dbfs path to the raw_files volume (optionally a subdir)."""
    base = f"/Volumes/{CATALOG}/{SCHEMA}/raw_files"
    return f"{base}/{subdir}" if subdir else base


def upload_file(local_path: str, dbfs_dest: str):
    """Copy a local file to a dbfs/Volume path via the CLI (profile-aware)."""
    parent = os.path.dirname(dbfs_dest)
    subprocess.run(["databricks", "fs", "mkdirs", f"dbfs:{parent}", "-p", PROFILE],
                   capture_output=True, text=True)
    cmd = [
        "databricks", "fs", "cp", "--overwrite",
        local_path, f"dbfs:{dbfs_dest}", "-p", PROFILE,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"upload failed: {res.stderr}\n{res.stdout}")
    return dbfs_dest


def load_table(df, schema_name: str, table: str, select_expr: str = "*",
               partition_hint: str | None = None):
    """Idempotently (CREATE OR REPLACE) load a pandas DataFrame into a UC table.

    Writes parquet locally -> uploads to the raw_files volume -> CREATE OR REPLACE
    TABLE AS SELECT {select_expr} FROM read_files(<parquet>). Returns row count.
    """
    import pandas as pd  # noqa

    target = fq(schema_name, table)
    token = f"{table}_{uuid.uuid4().hex[:8]}"
    local = os.path.join(tempfile.gettempdir(), f"{token}.parquet")
    # Naive datetime64 columns -> tz-aware UTC so parquet encodes a zoned
    # timestamp (Spark TIMESTAMP) rather than timestamp_ntz (which is a gated
    # Delta table feature). Values are already UTC by convention.
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            if getattr(df[col].dtype, "tz", None) is None:
                df[col] = df[col].dt.tz_localize("UTC")
    df.to_parquet(local, index=False)
    dbfs_dir = volume_path(f"staging/{token}")
    # Filename must NOT start with '_' or '.' — Spark/read_files treats such
    # files as hidden metadata and silently skips them (0 rows loaded).
    dbfs_file = f"{dbfs_dir}/data.parquet"
    upload_file(local, dbfs_file)

    stmt = (
        f"CREATE OR REPLACE TABLE {target} AS\n"
        f"SELECT {select_expr} FROM read_files("
        f"'{dbfs_file}', format => 'parquet')"
    )
    sql(stmt, wait_timeout="50s")
    # Clean up staged file.
    subprocess.run(["databricks", "fs", "rm", f"dbfs:{dbfs_file}", "-p", PROFILE],
                   capture_output=True, text=True)
    os.remove(local)
    n = scalar(f"SELECT count(*) FROM {target}")
    return int(n)


if __name__ == "__main__":
    # Quick connectivity + permission probe.
    print(f"profile={PROFILE} warehouse={WAREHOUSE_ID} target={TARGET}")
    print("current catalog:", scalar("SELECT current_catalog()"))
    print("current user:", scalar("SELECT current_user()"))
