"""Hardening checks for the Code Explorer demo index."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from codegraph.index_guard import (
    BUILDER_ID,
    BUILDER_VERSION,
    DEMO_DB_NAME,
    PRODUCT_DB_NAME,
    index_is_usable,
    inspect_demo_index,
    require_demo_db_path,
)


def _write_demo_db(path: Path, *, paths: list[str], builder: str = BUILDER_ID) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT, name TEXT, qualified_name TEXT,
                file_path TEXT, start_line INTEGER, end_line INTEGER,
                signature TEXT, docstring TEXT
            );
            CREATE TABLE project_metadata (key TEXT PRIMARY KEY, value TEXT);
            """
        )
        for i, fp in enumerate(paths):
            name = Path(fp).stem
            conn.execute(
                "INSERT INTO nodes (kind, name, qualified_name, file_path, "
                "start_line, end_line, signature, docstring) "
                "VALUES ('function', ?, ?, ?, 1, 2, ?, NULL)",
                (name, name, fp, f"function {name}()"),
            )
        conn.execute(
            "INSERT INTO project_metadata(key, value) VALUES ('builder', ?)",
            (builder,),
        )
        conn.execute(
            "INSERT INTO project_metadata(key, value) VALUES ('builder_version', ?)",
            (BUILDER_VERSION,),
        )
        conn.commit()
    finally:
        conn.close()


class TestIndexGuard:
    def test_refuse_product_db_name(self, tmp_path):
        db = tmp_path / PRODUCT_DB_NAME
        _write_demo_db(
            db,
            paths=["demo_api_ui/a.jsx", "demo_api_server/b.js"],
        )
        info = inspect_demo_index(db)
        assert info["ok"] is False
        assert "product" in info["error"].lower() or PRODUCT_DB_NAME in info["error"]
        assert require_demo_db_path(db) is not None

    def test_refuse_missing_builder(self, tmp_path):
        db = tmp_path / DEMO_DB_NAME
        _write_demo_db(
            db,
            paths=["demo_api_ui/a.jsx", "demo_api_server/b.js"],
            builder="host-product",
        )
        info = inspect_demo_index(db)
        assert info["ok"] is False
        assert "builder" in info["error"]

    def test_refuse_nested_live_repo_paths(self, tmp_path):
        db = tmp_path / DEMO_DB_NAME
        _write_demo_db(
            db,
            paths=[
                "live-repo/demo_api_ui/a.jsx",
                "live-repo/demo_api_server/b.js",
            ],
        )
        info = inspect_demo_index(db, require_scope=False)
        assert info["ok"] is False
        assert "live-repo" in info["error"]

    def test_require_ui_and_api_when_scoped(self, tmp_path):
        db = tmp_path / DEMO_DB_NAME
        _write_demo_db(db, paths=["demo_api_server/b.js"])
        info = inspect_demo_index(db, require_scope=True)
        assert info["ok"] is False
        assert "demo_api_ui" in info["error"]

    def test_ok_with_ui_and_api(self, tmp_path):
        db = tmp_path / DEMO_DB_NAME
        _write_demo_db(
            db,
            paths=["demo_api_ui/App.jsx", "demo_api_server/server.js"],
        )
        info = inspect_demo_index(db, require_scope=True)
        assert info["ok"] is True
        assert info["uiFiles"] == 1
        assert info["apiFiles"] == 1
        assert info["samplePath"]
        assert index_is_usable(db, require_scope=True)


@pytest.mark.skipif(
    not (Path(__file__).resolve().parents[2] / "scripts" / "build-codegraph.py").is_file(),
    reason="indexer script missing",
)
class TestIndexerSmoke:
    """CI smoke: default scope indexes CodeExplorerPage + an API symbol."""

    def test_default_scope_indexes_ui_and_api(self, tmp_path):
        import importlib.util
        import sys

        repo = Path(__file__).resolve().parents[2]
        script = repo / "scripts" / "build-codegraph.py"
        spec = importlib.util.spec_from_file_location("build_codegraph", script)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["build_codegraph"] = mod
        spec.loader.exec_module(mod)

        out = tmp_path / DEMO_DB_NAME
        mod.build(root=repo, out=out, include_dirs=mod.DEFAULT_INCLUDE_DIRS)

        info = inspect_demo_index(out, repo_root=repo, require_scope=True)
        assert info["ok"] is True, info.get("error")
        assert info["uiFiles"] >= 1
        assert info["apiFiles"] >= 1

        conn = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
        try:
            names = {
                r[0] for r in conn.execute("SELECT name FROM nodes")
            }
            meta = dict(conn.execute("SELECT key, value FROM project_metadata"))
        finally:
            conn.close()
        assert "CodeExplorerPage" in names
        assert meta.get("builder") == BUILDER_ID

    def test_wrong_root_nesting_fails_guard(self, tmp_path):
        """Simulate the /app indexer bug: paths prefixed with live-repo/."""
        db = tmp_path / DEMO_DB_NAME
        _write_demo_db(
            db,
            paths=[
                "live-repo/demo_api_ui/CodeExplorerPage.jsx",
                "live-repo/demo_api_server/server.js",
            ],
        )
        assert index_is_usable(db, require_scope=False) is False
        err = inspect_demo_index(db, require_scope=False)["error"]
        assert "live-repo" in err
