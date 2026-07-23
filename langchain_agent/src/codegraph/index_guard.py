# langchain_agent/src/codegraph/index_guard.py
"""Hardening checks for the Code Explorer (demo) symbol index.

The host CodeGraph product daemon also writes `.codegraph/codegraph.db` on the
same bind mount. The demo index MUST stay on demo-codegraph.db with an explicit
builder marker, paths relative to REPO_SRC_ROOT (never `live-repo/...`), and
non-zero UI + API coverage when those trees exist.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Optional

BUILDER_ID = "demo-build-codegraph"
BUILDER_VERSION = "1"

# Paths relative to REPO_SRC_ROOT — nested docker mount prefixes are fatal.
FORBIDDEN_PATH_PREFIXES = ("live-repo/", "repo-src/")
SCOPE_PREFIXES = ("demo_api_ui/", "demo_api_server/")

# Product / historic filename — never promote or treat as the demo query DB.
PRODUCT_DB_NAME = "codegraph.db"
DEMO_DB_NAME = "demo-codegraph.db"


def _metadata(conn: sqlite3.Connection) -> dict[str, str]:
    try:
        return dict(conn.execute("SELECT key, value FROM project_metadata").fetchall())
    except sqlite3.Error:
        return {}


def _should_require_scope(repo_root: Optional[Path]) -> bool:
    """Require UI+API coverage when those trees exist under the source root."""
    if repo_root is None:
        return True
    return (repo_root / "demo_api_ui").is_dir() and (repo_root / "demo_api_server").is_dir()


def inspect_demo_index(
    db_path: Path | str,
    *,
    repo_root: Optional[Path] = None,
    require_scope: Optional[bool] = None,
) -> dict[str, Any]:
    """Return stats + errors for a demo index DB (never raises)."""
    path = Path(db_path)
    check_scope = (
        _should_require_scope(repo_root)
        if require_scope is None
        else require_scope
    )
    result: dict[str, Any] = {
        "ok": False,
        "path": str(path),
        "error": None,
        "builder": None,
        "builderVersion": None,
        "nodes": 0,
        "files": 0,
        "uiFiles": 0,
        "apiFiles": 0,
        "samplePath": None,
        "forbiddenPaths": 0,
    }
    if not path.is_file() or path.stat().st_size <= 0:
        result["error"] = f"missing or empty index at {path}"
        return result
    if path.name == PRODUCT_DB_NAME:
        result["error"] = (
            f"refusing product/host CodeGraph DB name ({PRODUCT_DB_NAME}); "
            f"demo index must be {DEMO_DB_NAME}"
        )
        return result

    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        result["error"] = f"cannot open index: {exc}"
        return result

    try:
        meta = _metadata(conn)
        result["builder"] = meta.get("builder")
        result["builderVersion"] = meta.get("builder_version")
        if meta.get("builder") != BUILDER_ID:
            result["error"] = (
                f"missing builder marker (want {BUILDER_ID}, "
                f"got {meta.get('builder')!r}) — refuse host/product DB"
            )
            return result

        try:
            result["nodes"] = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
            result["files"] = conn.execute(
                "SELECT COUNT(DISTINCT file_path) FROM nodes"
            ).fetchone()[0]
            result["uiFiles"] = conn.execute(
                "SELECT COUNT(DISTINCT file_path) FROM nodes "
                "WHERE file_path LIKE 'demo_api_ui/%'"
            ).fetchone()[0]
            result["apiFiles"] = conn.execute(
                "SELECT COUNT(DISTINCT file_path) FROM nodes "
                "WHERE file_path LIKE 'demo_api_server/%'"
            ).fetchone()[0]
            sample = conn.execute(
                "SELECT file_path FROM nodes "
                "WHERE file_path LIKE 'demo_api_ui/%' "
                "OR file_path LIKE 'demo_api_server/%' "
                "LIMIT 1"
            ).fetchone()
            if not sample:
                sample = conn.execute(
                    "SELECT file_path FROM nodes LIMIT 1"
                ).fetchone()
            result["samplePath"] = sample[0] if sample else None
            forbidden = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE "
                + " OR ".join(
                    f"file_path LIKE '{p}%'" for p in FORBIDDEN_PATH_PREFIXES
                )
            ).fetchone()[0]
            result["forbiddenPaths"] = forbidden
        except sqlite3.Error as exc:
            result["error"] = f"index schema unusable: {exc}"
            return result

        if result["forbiddenPaths"]:
            result["error"] = (
                f"{result['forbiddenPaths']} nodes use nested mount prefixes "
                f"({', '.join(FORBIDDEN_PATH_PREFIXES)}) — indexer root is wrong"
            )
            return result
        if result["nodes"] < 1:
            result["error"] = "index has zero symbols"
            return result
        if check_scope and result["uiFiles"] < 1:
            result["error"] = "index has zero demo_api_ui files"
            return result
        if check_scope and result["apiFiles"] < 1:
            result["error"] = "index has zero demo_api_server files"
            return result

        result["ok"] = True
        return result
    finally:
        conn.close()


def index_is_usable(
    db_path: Path | str,
    *,
    repo_root: Optional[Path] = None,
    require_scope: Optional[bool] = None,
) -> bool:
    """True when the demo index passes hardening checks."""
    return bool(
        inspect_demo_index(
            db_path, repo_root=repo_root, require_scope=require_scope
        ).get("ok")
    )


def require_demo_db_path(db_path: Path | str) -> Optional[str]:
    """Return an error string if path looks like the host product DB."""
    name = Path(db_path).name
    if name == PRODUCT_DB_NAME:
        return (
            f"CODEGRAPH_DB_PATH must not be {PRODUCT_DB_NAME} "
            f"(host CodeGraph product); use {DEMO_DB_NAME}"
        )
    return None
