"""Smoke tests for scripts/build-codegraph.py — focused on the atomic DB swap.

The live Code Explorer agent opens the index read-only per query while a refresh
may be rebuilding it, so build() must write a temp file and os.replace() it into
place rather than unlink-then-rebuild. These tests drive build() against a tiny
throwaway repo and assert the swap is clean.

Also locks the 2026-07-22 /app baked-indexer regression: when the script lives
outside the source tree, REPO_SRC_ROOT (or a positional root) must win so paths
are never nested as live-repo/... .
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sqlite3
import subprocess
import sys
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

    def test_baked_script_uses_repo_src_root_not_script_parent(self, tmp_path):
        """Reproduce #772: script at /app/indexer must index REPO_SRC_ROOT.

        Before the fix, REPO_ROOT = script.parent.parent (/app) walked
        live-repo/ as a nested prefix and broke read_file under /app/live-repo.
        """
        app = tmp_path / "app"
        indexer_dir = app / "indexer"
        live = app / "live-repo"
        (live / "demo_api_ui" / "src").mkdir(parents=True)
        (live / "demo_api_server" / "routes").mkdir(parents=True)
        (live / "demo_api_ui" / "src" / "CodeExplorerPage.jsx").write_text(
            "const CodeExplorerPage = () => null;\nexport default CodeExplorerPage;\n"
        )
        (live / "demo_api_server" / "routes" / "accounts.js").write_text(
            "function listAccounts() { return []; }\n"
        )
        indexer_dir.mkdir(parents=True)
        baked = indexer_dir / "build-codegraph.py"
        shutil.copy2(_SCRIPT, baked)

        out = tmp_path / "demo-codegraph.db"
        env = {
            **os.environ,
            "REPO_SRC_ROOT": str(live),
        }
        env.pop("CODEGRAPH_INDEX_ALL", None)
        proc = subprocess.run(
            [sys.executable, str(baked), "--out", str(out)],
            cwd=str(app),
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert out.is_file()

        conn = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
        try:
            paths = {r[0] for r in conn.execute("SELECT DISTINCT file_path FROM nodes")}
            names = {r[0] for r in conn.execute("SELECT name FROM nodes")}
            meta = dict(conn.execute("SELECT key, value FROM project_metadata"))
        finally:
            conn.close()

        assert "CodeExplorerPage" in names
        assert "listAccounts" in names
        assert "demo_api_ui/src/CodeExplorerPage.jsx" in paths
        assert "demo_api_server/routes/accounts.js" in paths
        assert not any(p.startswith("live-repo/") for p in paths)
        assert meta.get("builder") == "demo-build-codegraph"

        # Guard must accept this DB for a tree that has UI+API dirs.
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
        from codegraph.index_guard import inspect_demo_index

        info = inspect_demo_index(out, repo_root=live, require_scope=True)
        assert info["ok"] is True, info.get("error")

    def test_nested_live_repo_paths_fail_guard_even_if_skip_removed(self, tmp_path):
        """If someone removes live-repo from SKIP_DIRS, nested paths must still fail guard."""
        app = tmp_path / "app"
        live = app / "live-repo"
        (live / "demo_api_ui" / "src").mkdir(parents=True)
        (live / "demo_api_server" / "routes").mkdir(parents=True)
        (live / "demo_api_ui" / "src" / "App.jsx").write_text(
            "export default function App() { return null; }\n"
        )
        (live / "demo_api_server" / "routes" / "ping.js").write_text(
            "function ping() {}\n"
        )
        out = tmp_path / "nested.db"
        mod = _load_indexer()
        # Simulate pre-#772 SKIP_DIRS (no live-repo prune) + wrong root=/app.
        mod.SKIP_DIRS = set(mod.SKIP_DIRS) - {"live-repo"}
        mod.build(root=app, out=out, include_dirs=None)

        conn = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
        try:
            paths = {r[0] for r in conn.execute("SELECT DISTINCT file_path FROM nodes")}
        finally:
            conn.close()
        assert any(p.startswith("live-repo/") for p in paths), paths

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
        from codegraph.index_guard import index_is_usable

        assert index_is_usable(out, require_scope=False) is False

    def test_baked_script_without_repo_src_root_misses_ui_api(self, tmp_path):
        """Unset REPO_SRC_ROOT + script under /app/indexer → no usable UI/API index."""
        app = tmp_path / "app"
        indexer_dir = app / "indexer"
        live = app / "live-repo"
        (live / "demo_api_ui" / "src").mkdir(parents=True)
        (live / "demo_api_server" / "routes").mkdir(parents=True)
        (live / "demo_api_ui" / "src" / "App.jsx").write_text(
            "export default function App() { return null; }\n"
        )
        (live / "demo_api_server" / "routes" / "ping.js").write_text(
            "function ping() {}\n"
        )
        indexer_dir.mkdir(parents=True)
        baked = indexer_dir / "build-codegraph.py"
        shutil.copy2(_SCRIPT, baked)

        out = tmp_path / "emptyish.db"
        env = {k: v for k, v in os.environ.items() if k != "REPO_SRC_ROOT"}
        env.pop("CODEGRAPH_INDEX_ALL", None)
        proc = subprocess.run(
            [sys.executable, str(baked), "--out", str(out)],
            cwd=str(app),
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
        from codegraph.index_guard import inspect_demo_index

        info = inspect_demo_index(out, repo_root=live, require_scope=True)
        assert info["ok"] is False, info

