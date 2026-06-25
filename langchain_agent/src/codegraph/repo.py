"""Repo source access for the Code Explorer agent's grep/read_file tools.

The agent answers from ACTUAL source, not just the codegraph metadata DB. In
production the indexed source subset is shipped into the image and REPO_SRC_ROOT
points at it (/app/repo-src); locally it defaults to the repo root (live files).

The skip/extension sets mirror scripts/build-codegraph.py so grep/read see
exactly what the graph indexes.
"""
import os
from pathlib import Path
from typing import Iterator, Optional

# Mirror scripts/build-codegraph.py SKIP_DIRS (+ the generated graph dirs) and
# its PY_EXTS|JS_EXTS, plus the React extensions the codebase uses.
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    ".codegraph", "graphify-out", ".planning", "dist", "build", "coverage",
    "certs", "data", "logs",
    "repo-src",  # repo-src = the staged source duplicate shipped into the agent image; never re-scan it.
}
SOURCE_EXTENSIONS = {".py", ".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"}


def repo_src_root() -> Path:
    """Root of the source tree the agent may read.

    REPO_SRC_ROOT wins (set to /app/repo-src in the image). Otherwise fall back
    to the repo root inferred from this file's location:
    langchain_agent/src/codegraph/repo.py -> parents[3] == repo root.
    """
    env = os.getenv("REPO_SRC_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[3]


def iter_source_files(root: Optional[Path] = None) -> Iterator[Path]:
    """Yield indexed source files under root, skipping vendored/generated dirs."""
    base = root or repo_src_root()
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
        ]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SOURCE_EXTENSIONS:
                yield p


def resolve_in_root(rel_path: str, root: Optional[Path] = None) -> Optional[Path]:
    """Resolve rel_path under root. Return None if it escapes root or is missing."""
    base = (root or repo_src_root()).resolve()
    try:
        candidate = (base / rel_path).resolve()
    except (ValueError, OSError):
        return None
    if candidate != base and not candidate.is_relative_to(base):
        return None
    if not candidate.is_file():
        return None
    return candidate
