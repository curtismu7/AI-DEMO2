"""Tests for repo.py — source root resolution, iteration, and safe path resolve."""
import os
from pathlib import Path

import pytest

from src.codegraph import repo


def _make_tree(tmp_path: Path) -> Path:
    (tmp_path / "demo_api_server" / "services").mkdir(parents=True)
    (tmp_path / "demo_api_server" / "services" / "a.js").write_text("const a = 1;\n")
    (tmp_path / "demo_api_server" / "b.py").write_text("x = 1\n")
    (tmp_path / "node_modules" / "dep").mkdir(parents=True)
    (tmp_path / "node_modules" / "dep" / "c.js").write_text("ignored\n")
    (tmp_path / ".codegraph").mkdir()
    (tmp_path / ".codegraph" / "d.js").write_text("ignored\n")
    (tmp_path / "readme.md").write_text("# not source\n")
    return tmp_path


def test_repo_src_root_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
    assert repo.repo_src_root() == tmp_path.resolve()


def test_repo_src_root_falls_back_to_repo_root(monkeypatch):
    monkeypatch.delenv("REPO_SRC_ROOT", raising=False)
    root = repo.repo_src_root()
    assert (root / "langchain_agent").is_dir()


def test_iter_source_files_includes_code_excludes_vendor(tmp_path):
    _make_tree(tmp_path)
    found = {p.relative_to(tmp_path).as_posix() for p in repo.iter_source_files(tmp_path)}
    assert "demo_api_server/services/a.js" in found
    assert "demo_api_server/b.py" in found
    assert "node_modules/dep/c.js" not in found
    assert ".codegraph/d.js" not in found
    assert "readme.md" not in found


def test_resolve_in_root_ok(tmp_path):
    _make_tree(tmp_path)
    target = repo.resolve_in_root("demo_api_server/b.py", tmp_path)
    assert target is not None and target.name == "b.py"


def test_resolve_in_root_rejects_traversal(tmp_path):
    _make_tree(tmp_path)
    assert repo.resolve_in_root("../etc/passwd", tmp_path) is None
    assert repo.resolve_in_root("/etc/passwd", tmp_path) is None


def test_resolve_in_root_missing_file(tmp_path):
    _make_tree(tmp_path)
    assert repo.resolve_in_root("demo_api_server/nope.js", tmp_path) is None


def test_iter_source_files_excludes_repo_src_staging_dir(tmp_path):
    (tmp_path / "demo_api_server").mkdir()
    (tmp_path / "demo_api_server" / "real.js").write_text("x\n")
    (tmp_path / "repo-src" / "demo_api_server").mkdir(parents=True)
    (tmp_path / "repo-src" / "demo_api_server" / "dup.js").write_text("x\n")
    found = {p.relative_to(tmp_path).as_posix() for p in repo.iter_source_files(tmp_path)}
    assert "demo_api_server/real.js" in found
    assert "repo-src/demo_api_server/dup.js" not in found
