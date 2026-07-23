"""Tests for deterministic Code Explorer retrieval."""
from unittest.mock import patch

from codegraph.db import _sanitize_fts
from codegraph.retrieve import gather_context, _extra_terms, _hit_relevance


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

def test_extra_terms_compounds_mcp_gateway():
    terms = [t.lower() for t in _extra_terms("How does the MCP gateway work?")]
    assert any(t in terms for t in ("mcpgateway", "mcp_gateway"))

def test_sanitize_fts_drops_stopwords():
    q = _sanitize_fts("How does the MCP gateway work?")
    low = q.lower()
    assert "how" not in low
    assert "does" not in low
    assert "the" not in low
    assert "mcp" in low
    assert "gateway" in low

def test_gather_context_blends_search_when_explore_is_noisy():
    """FTS can return ≥3 irrelevant hits — search must still run."""
    noise = [
        {
            "name": f"noise{i}",
            "kind": "function",
            "file_path": f"demo_api_ui/noise{i}.js",
            "start_line": 1,
            "end_line": 2,
        }
        for i in range(5)
    ]
    useful = [
        {
            "name": "mcpGatewayClient",
            "kind": "function",
            "file_path": "demo_api_server/services/mcpGatewayClient.js",
            "start_line": 10,
            "end_line": 40,
        }
    ]

    def fake_search(term: str):
        if "gateway" in term.lower() or "mcp" in term.lower():
            return useful
        return []

    with patch("codegraph.retrieve.db.explore", return_value=noise), \
         patch("codegraph.retrieve.db.search", side_effect=fake_search), \
         patch("codegraph.retrieve._read_window", return_value="10\tfunction mcpGatewayClient() {}"):
        ctx = gather_context("How does the MCP gateway work?")
    assert "mcpGatewayClient" in ctx
    assert "mcpGatewayClient.js" in ctx

def test_gather_context_prefers_impl_over_tests():
    test_hit = {
        "name": "test_mcp_gateway_flow",
        "kind": "function",
        "file_path": "demo_mcp_gateway/tests/gateway-auth.test.ts",
        "start_line": 1,
        "end_line": 5,
    }
    impl_hit = {
        "name": "authorizeMcpRequest",
        "kind": "function",
        "file_path": "demo_mcp_gateway/src/authorizeMcpRequest.ts",
        "start_line": 20,
        "end_line": 80,
    }
    with patch("codegraph.retrieve.db.explore", return_value=[test_hit, impl_hit]), \
         patch("codegraph.retrieve.db.search", return_value=[test_hit, impl_hit]), \
         patch("codegraph.retrieve._read_window",
               side_effect=lambda path, *a, **k: f"src from {path}"):
        ctx = gather_context("How does the MCP gateway work?")
    # Implementation excerpt should appear; test path should not be first file.
    assert "demo_mcp_gateway/src/authorizeMcpRequest.ts" in ctx
    assert ctx.index("authorizeMcpRequest.ts") < ctx.index("gateway-auth.test.ts")


def test_hit_relevance_boosts_callToolViaGateway_chokepoint():
    bff = {
        "name": "callToolViaGateway",
        "kind": "function",
        "file_path": "demo_api_server/services/mcpGatewayClient.js",
        "qualified_name": "callToolViaGateway",
    }
    ui = {
        "name": "McpGatewayConfig",
        "kind": "function",
        "file_path": "demo_api_ui/src/components/McpGatewayConfig.jsx",
        "qualified_name": "McpGatewayConfig",
    }
    terms = _extra_terms("How does callToolViaGateway reach PingGateway?")
    assert _hit_relevance(bff, terms) > _hit_relevance(ui, terms)


def test_gather_context_surfaces_callToolViaGateway_for_pinggateway_chip():
    noise = [
        {
            "name": "McpGatewayConfig",
            "kind": "function",
            "file_path": "demo_api_ui/src/components/McpGatewayConfig.jsx",
            "start_line": 1,
            "end_line": 20,
        }
    ]
    useful = [
        {
            "name": "callToolViaGateway",
            "kind": "function",
            "file_path": "demo_api_server/services/mcpGatewayClient.js",
            "start_line": 96,
            "end_line": 200,
        }
    ]

    def fake_search(term: str):
        t = term.lower()
        if "calltool" in t or "gateway" in t or "mcp" in t:
            return useful
        return []

    with patch("codegraph.retrieve.db.explore", return_value=noise), \
         patch("codegraph.retrieve.db.search", side_effect=fake_search), \
         patch(
             "codegraph.retrieve._read_window",
             return_value="96\tasync function callToolViaGateway() {}",
         ):
        ctx = gather_context("How does callToolViaGateway reach PingGateway?")
    assert "callToolViaGateway" in ctx
    assert "mcpGatewayClient.js" in ctx
