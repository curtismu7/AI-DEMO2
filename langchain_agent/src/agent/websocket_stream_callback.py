"""
DEPRECATED — removed in Phase 276.
Streaming is now handled by langchain_mcp_agent via
graph.astream_events(version="v2"). Do not import WebSocketStreamCallbackHandler.
"""
raise ImportError(
    "WebSocketStreamCallbackHandler was removed in Phase 276. "
    "Use graph.astream_events(version='v2') instead."
)
