"""Unit tests for codegraph.ensure_index — promote + indexer resolution."""
from pathlib import Path
from unittest.mock import patch

import sqlite3

from codegraph.ensure_index import (
    build_query_index_sync,
    db_is_ready,
    ensure_query_index,
    legacy_db_path,
    promote_file,
    resolve_indexer_script,
)
from codegraph.index_guard import BUILDER_ID, BUILDER_VERSION, DEMO_DB_NAME


def _write_usable_demo_db(path: Path) -> None:
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
        for name, fp in (
            ("App", "demo_api_ui/App.jsx"),
            ("ping", "demo_api_server/ping.js"),
        ):
            conn.execute(
                "INSERT INTO nodes (kind, name, qualified_name, file_path, "
                "start_line, end_line, signature, docstring) "
                "VALUES ('function', ?, ?, ?, 1, 1, ?, NULL)",
                (name, name, fp, f"function {name}()"),
            )
        conn.execute(
            "INSERT INTO project_metadata(key, value) VALUES ('builder', ?)",
            (BUILDER_ID,),
        )
        conn.execute(
            "INSERT INTO project_metadata(key, value) VALUES ('builder_version', ?)",
            (BUILDER_VERSION,),
        )
        conn.commit()
    finally:
        conn.close()


class TestDbIsReady:
    def test_missing(self, tmp_path):
        assert db_is_ready(tmp_path / "nope.db") is False

    def test_empty(self, tmp_path):
        p = tmp_path / "empty.db"
        p.write_bytes(b"")
        assert db_is_ready(p) is False

    def test_nonempty(self, tmp_path):
        p = tmp_path / "ok.db"
        p.write_bytes(b"x" * 32)
        assert db_is_ready(p) is True


class TestPromoteAndEnsure:
    def test_promote_file(self, tmp_path):
        src = tmp_path / DEMO_DB_NAME
        dest = tmp_path / "query" / DEMO_DB_NAME
        _write_usable_demo_db(src)
        assert promote_file(src, dest) is True
        assert dest.is_file() and dest.stat().st_size > 0

    def test_refuse_promote_product_name(self, tmp_path):
        src = tmp_path / "codegraph.db"
        dest = tmp_path / "query" / DEMO_DB_NAME
        _write_usable_demo_db(src)
        # Even with builder marker, wrong filename must not promote.
        assert promote_file(src, dest) is False
        assert not dest.exists()

    def test_ensure_promotes_when_query_empty(self, tmp_path):
        root = tmp_path / "repo"
        (root / "demo_api_ui").mkdir(parents=True)
        (root / "demo_api_server").mkdir(parents=True)
        legacy = legacy_db_path(root)
        _write_usable_demo_db(legacy)
        query = tmp_path / "query" / DEMO_DB_NAME
        query.parent.mkdir(parents=True)
        query.write_bytes(b"")  # empty placeholder
        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)), \
             patch("codegraph.ensure_index.repo_src_root", return_value=root):
            assert ensure_query_index(root) is True
        assert query.is_file() and query.stat().st_size > 64

    def test_ensure_noop_when_query_ready(self, tmp_path):
        root = tmp_path / "repo"
        (root / "demo_api_ui").mkdir(parents=True)
        (root / "demo_api_server").mkdir(parents=True)
        query = tmp_path / DEMO_DB_NAME
        _write_usable_demo_db(query)
        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)), \
             patch("codegraph.ensure_index.repo_src_root", return_value=root):
            assert ensure_query_index(root) is True

    def test_legacy_db_path_is_demo_name(self, tmp_path):
        p = legacy_db_path(tmp_path)
        assert p.name == DEMO_DB_NAME
        assert p.name != "codegraph.db"


class TestResolveIndexer:
    def test_prefers_env(self, tmp_path):
        baked = tmp_path / "env-indexer.py"
        baked.write_text("print(1)\n")
        staged = tmp_path / "scripts" / "build-codegraph.py"
        staged.parent.mkdir()
        staged.write_text("print(2)\n")
        with patch.dict("os.environ", {"CODEGRAPH_INDEXER": str(baked)}):
            assert resolve_indexer_script(tmp_path) == baked

    def test_falls_back_to_staged(self, tmp_path):
        staged = tmp_path / "scripts" / "build-codegraph.py"
        staged.parent.mkdir()
        staged.write_text("print(2)\n")
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("CODEGRAPH_INDEXER", None)
            with patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
                assert resolve_indexer_script(tmp_path) == staged

    def test_none_when_missing(self, tmp_path):
        import os
        os.environ.pop("CODEGRAPH_INDEXER", None)
        with patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
            assert resolve_indexer_script(tmp_path) is None


class TestBuildQueryIndexSync:
    def test_noop_when_query_ready(self, tmp_path):
        root = tmp_path / "repo"
        (root / "demo_api_ui").mkdir(parents=True)
        (root / "demo_api_server").mkdir(parents=True)
        query = tmp_path / DEMO_DB_NAME
        _write_usable_demo_db(query)
        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)), \
             patch("codegraph.ensure_index.repo_src_root", return_value=root):
            assert build_query_index_sync(root) is True

    def test_runs_indexer_when_empty(self, tmp_path):
        root = tmp_path / "repo"
        (root / "demo_api_ui").mkdir(parents=True)
        (root / "demo_api_server").mkdir(parents=True)
        scripts = root / "scripts"
        scripts.mkdir()
        (scripts / "build-codegraph.py").write_text("print('ok')\n")
        query = tmp_path / "out" / DEMO_DB_NAME

        def fake_run(cmd, **kwargs):
            out = Path(cmd[cmd.index("--out") + 1])
            _write_usable_demo_db(out)
            return type("R", (), {"returncode": 0, "stdout": "Found 1 nodes\n", "stderr": ""})()

        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)), \
             patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"), \
             patch("codegraph.ensure_index.repo_src_root", return_value=root), \
             patch("subprocess.run", side_effect=fake_run):
            assert build_query_index_sync(root) is True
            assert query.is_file() and query.stat().st_size > 0
