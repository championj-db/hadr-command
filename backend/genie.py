"""Natural-language "Ask the COP" assistant, backed by a Databricks Genie space.

Thin orchestration over dbx.genie_ask: the Genie space (see config.GENIE_SPACE_ID)
holds the curated table set, joins and sample questions; here we just relay the
question, shape the response for the UI, and attach the standard AI caveat."""

from . import config, dbx


def ask(question: str, conversation_id: str | None = None) -> dict:
    """Answer a question against the HADR Genie space.

    Returns the generated SQL, tabular result (capped) and Genie's text summary,
    plus the conversation_id so the UI can send follow-ups in the same thread.
    """
    result = dbx.genie_ask(config.GENIE_SPACE_ID, question, conversation_id)
    result["caveat"] = "AI-generated from the COP data — verify SQL and figures before release."
    return result
