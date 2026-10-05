"""Opik LLM tracing — opt-in via OPIK_API_KEY, otherwise a no-op.

Opik reads OPIK_API_KEY / OPIK_WORKSPACE / OPIK_PROJECT_NAME / OPIK_URL_OVERRIDE
from the environment itself; this module only decides whether to attach a tracer.
"""
import logging
import os

logger = logging.getLogger(__name__)


def opik_callbacks(session_id: str) -> list:
    """Return [OpikTracer] when tracing is configured, else []. Never raises."""
    if not os.getenv("OPIK_API_KEY"):
        return []
    try:
        from opik.integrations.langchain import OpikTracer

        return [OpikTracer(thread_id=session_id, tags=["langchain_agent"])]
    except Exception as exc:  # missing package or bad config must not break chat
        logger.warning("Opik tracing disabled: %s", exc)
        return []
