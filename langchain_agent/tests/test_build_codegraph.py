"""Smoke tests for scripts/build-codegraph.py — focused on the atomic DB swap.

The live Code Explorer agent opens the index read-only per query while a refresh
may be rebuilding it, so build() must write a temp file and os.replace() it into
place rather than unlink-then-rebuild. These tests drive build() against a tiny
throwaway repo and assert the swap is clean.
"""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build-codegraph.py"


def _load_indexer():
    spec = importlib.util.spec_from_file_location("build_codegraph", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _names_in(db: Path) -> set:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM nodes")}
    finally:
        conn.close()


@pytest.mark.skipif(not _SCRIPT.is_file(), reason="indexer script not found")
class TestBuildCodegraphAtomicSwap:
    @staticmethod
    def _make_repo(root: Path) -> Path:
        (root / "pkg").mkdir()
        (root / "pkg" / "mod.py").write_text("def greet(name):\n    return f'hi {name}'\n")
        return root

    def test_build_writes_valid_db_and_leaves_no_tmp(self, tmp_path, monkeypatch):
        repo = self._make_repo(tmp_path)
        db = tmp_path / ".codegraph" / "demo-codegraph.db"
        mod = _load_indexer()
        monkeypatch.setattr(mod, "REPO_ROOT", repo)
        monkeypatch.setattr(mod, "DB_PATH", db)

        mod.build()

        assert db.is_file()
        # A clean swap leaves no temp file behind.
        assert not (db.parent / (db.name + ".tmp")).exists()
        assert "greet" in _names_in(db)

    def test_rebuild_atomically_replaces_existing_db(self, tmp_path, monkeypatch):
        repo = self._make_repo(tmp_path)
        db = tmp_path / ".codegraph" / "demo-codegraph.db"
        mod = _load_indexer()
        monkeypatch.setattr(mod, "REPO_ROOT", repo)
        monkeypatch.setattr(mod, "DB_PATH", db)

        mod.build()
        first_inode = db.stat().st_ino

        # Change the source and rebuild over the existing db.
        (repo / "pkg" / "mod.py").write_text("def farewell():\n    return 'bye'\n")
        mod.build()

        assert db.is_file()
        assert not (db.parent / (db.name + ".tmp")).exists()
        names = _names_in(db)
        assert "farewell" in names
        assert "greet" not in names
        # os.replace() installs a fresh file (new inode), proving the swap.
        assert db.stat().st_ino != first_inode

    def test_build_respects_root_and_include_dirs(self, tmp_path):
        """Paths must be relative to the passed root (not the script location)."""
        repo = tmp_path / "live"
        (repo / "demo_api_ui" / "src").mkdir(parents=True)
        (repo / "demo_api_server" / "routes").mkdir(parents=True)
        (repo / "other_pkg").mkdir()
        (repo / "demo_api_ui" / "src" / "App.jsx").write_text(
            "export default function App() { return null; }\n"
        )
        (repo / "demo_api_server" / "routes" / "ping.js").write_text(
            "function ping() { return 'ok'; }\n"
        )
        (repo / "other_pkg" / "skip.py").write_text("def skip_me():\n    pass\n")
        db = tmp_path / "out" / "demo-codegraph.db"
        mod = _load_indexer()

        mod.build(root=repo, out=db, include_dirs=mod.DEFAULT_INCLUDE_DIRS)

        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            paths = {r[0] for r in conn.execute("SELECT DISTINCT file_path FROM nodes")}
            names = {r[0] for r in conn.execute("SELECT name FROM nodes")}
        finally:
            conn.close()

        assert "demo_api_ui/src/App.jsx" in paths
        assert "demo_api_server/routes/ping.js" in paths
        assert not any(p.startswith("other_pkg/") for p in paths)
        assert "App" in names
        assert "ping" in names
        assert "skip_me" not in names
