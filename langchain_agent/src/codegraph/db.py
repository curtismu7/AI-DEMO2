"""
SQLite query layer for the CodeGraph index.

All functions open a read-only connection to CODEGRAPH_DB_PATH,
execute a single query, and return a list of plain dicts.
_get_conn() is a thin seam that tests can patch.
"""
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

_MODULE_DIR = Path(__file__).resolve().parent          # .../langchain_agent/src/codegraph
_REPO_ROOT = _MODULE_DIR.parent.parent.parent          # .../AI-Demo
_DEFAULT_DB = str(_REPO_ROOT / ".codegraph" / "codegraph.db")

CODEGRAPH_DB_PATH: str = os.getenv("CODEGRAPH_DB_PATH", _DEFAULT_DB)
_CAP_EXPLORE = 10
_CAP_OTHER = 20


def _get_conn() -> sqlite3.Connection:
    """Open a read-only connection. Tests patch this to inject in-memory DBs."""
    conn = sqlite3.connect(f"file:{CODEGRAPH_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _rows_to_dicts(rows) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


def _sanitize_fts(query: str) -> str:
    """Convert a natural-language query to a safe FTS5 expression."""
    cleaned = re.sub(r"[^\w\s]", " ", query)
    tokens = [t for t in cleaned.split() if len(t) > 1]
    return " OR ".join(tokens[:6]) if tokens else ""


def explore(query: str) -> list[dict[str, Any]]:
    """
    Full-text search across node names, qualified names, docstrings, and
    signatures.  Returns up to 10 nodes with location and signature info.
    """
    fts_query = _sanitize_fts(query)
    if not fts_query:
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT n.id, n.kind, n.name, n.qualified_name,
                   n.file_path, n.start_line, n.end_line,
                   n.signature, n.docstring
            FROM nodes n
            WHERE n.rowid IN (
                SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?
            )
            LIMIT ?
            """,
            (fts_query, _CAP_EXPLORE),
        ).fetchall()
        return _rows_to_dicts(rows)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def search(term: str) -> list[dict[str, Any]]:
    """
    Exact / prefix search on node names (case-insensitive LIKE).
    Returns up to 20 nodes ordered by name.
    """
    if not term.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT id, kind, name, qualified_name,
                   file_path, start_line, end_line, signature
            FROM nodes
            WHERE lower(name) LIKE lower(?)
            ORDER BY name
            LIMIT ?
            """,
            (f"%{term}%", _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def callers(symbol: str) -> list[dict[str, Any]]:
    """
    Return all nodes that call the named symbol (edges.kind = 'calls').
    """
    if not symbol.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT caller.kind, caller.name, caller.qualified_name,
                   caller.file_path, caller.start_line, e.line AS call_line
            FROM edges e
            JOIN nodes target_node ON target_node.id = e.target
            JOIN nodes caller      ON caller.id      = e.source
            WHERE lower(target_node.name) = lower(?)
              AND e.kind = 'calls'
            LIMIT ?
            """,
            (symbol, _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def callees(symbol: str) -> list[dict[str, Any]]:
    """
    Return all nodes called by the named symbol (edges.kind = 'calls').
    """
    if not symbol.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT callee.kind, callee.name, callee.qualified_name,
                   callee.file_path, callee.start_line, e.line AS call_line
            FROM edges e
            JOIN nodes source_node ON source_node.id = e.source
            JOIN nodes callee       ON callee.id      = e.target
            WHERE lower(source_node.name) = lower(?)
              AND e.kind = 'calls'
            LIMIT ?
            """,
            (symbol, _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
