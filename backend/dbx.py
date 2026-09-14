"""Databricks access: WorkspaceClient singleton + SQL Statement Execution helpers.

All warehouse reads go through `query()`, which uses EXTERNAL_LINKS + JSON_ARRAY so
large results (layer_frames, buildings) stream via presigned URLs instead of the
inline 16 MiB cap. Named :param binding only — never interpolate values into SQL.
"""

import json
import logging
import threading
import time

import httpx
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    Disposition,
    Format,
    StatementParameterListItem,
    StatementState,
)

from . import config

log = logging.getLogger(__name__)

_lock = threading.Lock()
_client: WorkspaceClient | None = None


def ws() -> WorkspaceClient:
    global _client
    with _lock:
        if _client is None:
            if config.PROFILE:
                _client = WorkspaceClient(profile=config.PROFILE)
            else:  # Databricks Apps: ambient service-principal credentials
                _client = WorkspaceClient()
        return _client


def obo_client(user_token: str) -> WorkspaceClient:
    """On-behalf-of-user client from the X-Forwarded-Access-Token header."""
    return WorkspaceClient(host=ws().config.host, token=user_token, auth_type="pat")


def query(sql: str, params: dict | None = None, timeout_s: int = 120) -> list[dict]:
    """Execute a statement and return all rows as list[dict]."""
    w = ws()
    stmt_params = (
        [StatementParameterListItem(name=k, value=str(v)) for k, v in params.items()]
        if params
        else None
    )
    resp = w.statement_execution.execute_statement(
        warehouse_id=config.WAREHOUSE_ID,
        statement=sql,
        parameters=stmt_params,
        disposition=Disposition.EXTERNAL_LINKS,
        format=Format.JSON_ARRAY,
        wait_timeout="30s",
    )
    deadline = time.monotonic() + timeout_s
    while resp.status and resp.status.state in (StatementState.PENDING, StatementState.RUNNING):
        if time.monotonic() > deadline:
            w.statement_execution.cancel_execution(resp.statement_id)
            raise TimeoutError(f"statement timed out after {timeout_s}s")
        time.sleep(1.0)
        resp = w.statement_execution.get_statement(resp.statement_id)
    if not resp.status or resp.status.state != StatementState.SUCCEEDED:
        err = resp.status.error.message if resp.status and resp.status.error else "unknown"
        raise RuntimeError(f"statement failed: {err}")

    cols = [c.name for c in resp.manifest.schema.columns]
    rows: list[dict] = []
    total_chunks = resp.manifest.total_chunk_count or 0
    with httpx.Client(timeout=60) as http:
        for n in range(total_chunks):
            chunk = w.statement_execution.get_statement_result_chunk_n(resp.statement_id, n)
            for link in chunk.external_links or []:
                # Presigned URL — must be fetched WITHOUT auth headers.
                data = http.get(link.external_link).raise_for_status().json()
                rows.extend(dict(zip(cols, r)) for r in data)
    return rows


def exec_dml(sql: str, params: dict | None = None) -> None:
    """Fire-and-check DML (poller appends). Small payloads, inline disposition."""
    w = ws()
    stmt_params = (
        [StatementParameterListItem(name=k, value=str(v)) for k, v in params.items()]
        if params
        else None
    )
    resp = w.statement_execution.execute_statement(
        warehouse_id=config.WAREHOUSE_ID,
        statement=sql,
        parameters=stmt_params,
        wait_timeout="30s",
    )
    state = resp.status.state if resp.status else None
    if state not in (StatementState.SUCCEEDED, StatementState.RUNNING, StatementState.PENDING):
        err = resp.status.error.message if resp.status and resp.status.error else "unknown"
        raise RuntimeError(f"DML failed: {err}")


def chat(messages: list[dict], max_tokens: int = 1500) -> str:
    """Call the FMAPI chat endpoint (SITREP). messages = [{role, content}, ...]."""
    from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

    resp = ws().serving_endpoints.query(
        name=config.SITREP_ENDPOINT,
        messages=[ChatMessage(role=ChatMessageRole(m["role"]), content=m["content"]) for m in messages],
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content


def parse_json_col(rows: list[dict], col: str) -> None:
    """In-place parse of a JSON string column."""
    for r in rows:
        v = r.get(col)
        if isinstance(v, str):
            try:
                r[col] = json.loads(v)
            except json.JSONDecodeError:
                pass
