"""MCP client capability declaration for Enterprise-Managed Authorization.

The extension's first client requirement is advertising support in per-request
`_meta`; extensions are opt-in and never active by default, so a client that
does not declare it is not conformant even when its token flow is correct.

There are TWO initialize sites in connection.py (WebSocket and HTTP). Both must
carry the block — declaring it on one transport only would leave the other
silently non-conformant, which is exactly the kind of half-wired change that
passes a narrow test.
"""

from src.mcp.connection import build_request_meta, ENTERPRISE_MANAGED_AUTH_EXT

EXT = "io.modelcontextprotocol/enterprise-managed-authorization"


def test_extension_id_matches_the_spec_string_exactly():
    assert ENTERPRISE_MANAGED_AUTH_EXT == EXT


def test_meta_declares_the_enterprise_managed_extension():
    meta = build_request_meta()
    caps = meta["io.modelcontextprotocol/clientCapabilities"]
    assert EXT in caps["extensions"]
    assert caps["extensions"][EXT] == {}


def test_meta_preserves_caller_supplied_fields():
    meta = build_request_meta({"progressToken": "abc"})
    assert meta["progressToken"] == "abc"
    assert "io.modelcontextprotocol/clientCapabilities" in meta


def test_meta_does_not_mutate_the_callers_dict():
    base = {"progressToken": "abc"}
    build_request_meta(base)
    assert base == {"progressToken": "abc"}


def test_both_initialize_sites_declare_the_extension():
    """Guards the two-transport split: WebSocket and HTTP must both carry it."""
    import inspect
    from src.mcp import connection

    source = inspect.getsource(connection)
    initialize_blocks = source.count('"method": "initialize"')
    meta_calls = source.count("build_request_meta(")

    assert initialize_blocks >= 2, "expected both WebSocket and HTTP initialize sites"
    # One call per initialize site, plus the definition itself.
    assert meta_calls >= initialize_blocks, (
        f"{initialize_blocks} initialize sites but only {meta_calls} build_request_meta calls "
        "- one transport is not declaring the extension"
    )
