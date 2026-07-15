"""Tests for deterministic Code Explorer retrieval."""
from unittest.mock import patch

from codegraph.retrieve import gather_context, _extra_terms


def test_extra_terms_prefers_identifiers():
    terms = _extra_terms("How does demo_mcp_gateway authorizeMcpRequest work?")
    assert "authorizeMcpRequest" in terms or "demo_mcp_gateway" in terms


def test_gather_context_includes_hits_and_excerpts():
    fake_rows = [
        {
            "name": "routeTool",
            "kind": "function",
            "file_path": "demo_mcp_gateway/src/router.ts",
            "start_line": 78,
            "end_line": 90,
        }
    ]
    with patch("codegraph.retrieve.db.explore", return_value=fake_rows), \
         patch("codegraph.retrieve.db.search", return_value=[]), \
         patch("codegraph.retrieve._read_window", return_value="78\texport function routeTool() {}"):
        ctx = gather_context("How does routing work in the MCP gateway?")
    assert "Symbol index hits" in ctx
    assert "routeTool" in ctx
    assert "demo_mcp_gateway/src/router.ts" in ctx
    assert "Source excerpts" in ctx
