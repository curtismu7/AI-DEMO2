"""Unit tests for codegraph.db — uses in-memory SQLite matching the real schema."""
import sqlite3
import pytest
from unittest.mock import patch


def _make_db():
    """Create an in-memory DB with the CodeGraph schema and minimal test data."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            qualified_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            language TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            start_column INTEGER NOT NULL,
            end_column INTEGER NOT NULL,
            docstring TEXT,
            signature TEXT,
            updated_at INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE nodes_fts USING fts5(
            id, name, qualified_name, docstring, signature,
            content='nodes', content_rowid='rowid'
        );

        CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
            INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
            VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
        END;

        CREATE TABLE edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            line INTEGER
        );
    """)
    # Insert test data
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n1','function','handleTransfer','gateway.handleTransfer',
         'demo_mcp_gateway/src/index.ts',
         'typescript',10,40,0,0,
         'Handles MCP transfer tool calls','handleTransfer(req): Promise<void>',
         1000000)
    """)
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n2','function','authorize','authz.authorize',
         'demo_authz_server/src/decision.js',
         'javascript',5,30,0,0,
         'PingOne authorize decision endpoint','authorize(req, res)',
         1000001)
    """)
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n3','function','processPayment','bff.processPayment',
         'demo_api_server/routes/transactions.js',
         'javascript',50,80,0,0,
         'Processes a payment transaction','processPayment(req, res)',
         1000002)
    """)
    conn.execute("INSERT INTO edges VALUES (NULL,'n3','n1','calls',55)")
    conn.execute("INSERT INTO edges VALUES (NULL,'n3','n2','calls',60)")
    conn.commit()
    return conn


@pytest.fixture
def db_conn():
    return _make_db()


class TestExplore:
    def test_returns_matching_nodes(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("gateway transfer")
        assert len(results) >= 1
        names = [r["name"] for r in results]
        assert "handleTransfer" in names

    def test_returns_file_and_line(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("authorize")
        assert len(results) >= 1
        r = results[0]
        assert r["file_path"] == "demo_authz_server/src/decision.js"
        assert r["start_line"] == 5

    def test_empty_query_returns_empty(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("")
        assert results == []


class TestSearch:
    def test_finds_exact_name(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("authorize")
        assert len(results) >= 1
        assert results[0]["name"] == "authorize"

    def test_case_insensitive(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("HANDLETRANSFER")
        assert len(results) >= 1

    def test_no_match_returns_empty(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("xyznonexistent")
        assert results == []


class TestCallers:
    def test_finds_callers_of_handleTransfer(self, db_conn):
        from src.codegraph.db import callers
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callers("handleTransfer")
        assert len(results) == 1
        assert results[0]["name"] == "processPayment"

    def test_unknown_symbol_returns_empty(self, db_conn):
        from src.codegraph.db import callers
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callers("nonexistent")
        assert results == []


class TestCallees:
    def test_finds_callees_of_processPayment(self, db_conn):
        from src.codegraph.db import callees
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callees("processPayment")
        assert len(results) == 2
        names = {r["name"] for r in results}
        assert names == {"handleTransfer", "authorize"}
