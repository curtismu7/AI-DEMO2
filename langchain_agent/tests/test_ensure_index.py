"""Unit tests for codegraph.ensure_index — promote + indexer resolution."""
from pathlib import Path
from unittest.mock import patch

from codegraph.ensure_index import (
    db_is_ready,
    ensure_query_index,
    legacy_db_path,
    promote_file,
    resolve_indexer_script,
)


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
        src = tmp_path / "legacy.db"
        dest = tmp_path / "query" / "codegraph.db"
        src.write_bytes(b"legacy-bytes")
        assert promote_file(src, dest) is True
        assert dest.read_bytes() == b"legacy-bytes"

    def test_ensure_promotes_when_query_empty(self, tmp_path):
        root = tmp_path / "repo"
        legacy = legacy_db_path(root)
        legacy.parent.mkdir(parents=True)
        legacy.write_bytes(b"from-legacy")
        query = tmp_path / "query.db"
        query.write_bytes(b"")  # empty placeholder like Dockerfile touch
        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)), \
             patch("codegraph.ensure_index.repo_src_root", return_value=root):
            assert ensure_query_index(root) is True
        assert query.read_bytes() == b"from-legacy"

    def test_ensure_noop_when_query_ready(self, tmp_path):
        query = tmp_path / "query.db"
        query.write_bytes(b"already-good")
        with patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query)):
            assert ensure_query_index(tmp_path) is True
        assert query.read_bytes() == b"already-good"


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
            # Ensure env not set for this path
            import os
            os.environ.pop("CODEGRAPH_INDEXER", None)
            with patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
                assert resolve_indexer_script(tmp_path) == staged

    def test_none_when_missing(self, tmp_path):
        import os
        os.environ.pop("CODEGRAPH_INDEXER", None)
        with patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
            assert resolve_indexer_script(tmp_path) is None
