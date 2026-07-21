# langchain_agent/src/codegraph/ensure_index.py
"""Keep the Code Explorer query DB path populated.

Two durable failure modes shipped in production images:

1. Dockerfile `touch`es a zero-byte `/app/codegraph.db` when the bake file is
   missing — queries read that path and 503.
2. Staged `repo-src/scripts/build-codegraph.py` may ignore `--out` and write to
   `{REPO_SRC_ROOT}/.codegraph/codegraph.db` instead.

This module promotes the legacy write path into CODEGRAPH_DB_PATH (and prefers
a baked `/app/indexer/build-codegraph.py` that understands `--out`) so startup,
query, and Refresh all heal the mismatch instead of depending on a one-off
manual copy.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from codegraph.db import CODEGRAPH_DB_PATH
from codegraph.repo import repo_src_root

logger = logging.getLogger(__name__)

# Baked into the agent image by the Dockerfile (always has --out support).
_BAKED_INDEXER = Path("/app/indexer/build-codegraph.py")


def query_db_path() -> Path:
    """Path the Code Explorer tools and `_index_available` read."""
    return Path(CODEGRAPH_DB_PATH)


def legacy_db_path(root: Optional[Path] = None) -> Path:
    """Default write path used by older build-codegraph.py (no --out)."""
    return (root or repo_src_root()) / ".codegraph" / "codegraph.db"


def db_is_ready(path: Path) -> bool:
    """True when path exists and is non-empty."""
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def promote_file(src: Path, dest: Path) -> bool:
    """Atomically copy src → dest. Returns True on success."""
    if not db_is_ready(src):
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".promote-tmp")
        shutil.copy2(src, tmp)
        os.replace(tmp, dest)
        logger.info(
            "CodeGraph index promoted %s → %s (%s bytes)",
            src, dest, dest.stat().st_size,
        )
        return True
    except OSError as exc:
        logger.error("CodeGraph index promote failed (%s → %s): %s", src, dest, exc)
        return False


def ensure_query_index(root: Optional[Path] = None) -> bool:
    """Ensure CODEGRAPH_DB_PATH is non-empty, promoting the legacy path if needed.

    Safe to call on every query/startup — no-op when the query DB is already ready.
    Returns True when the query DB is usable afterwards.
    """
    dest = query_db_path()
    if db_is_ready(dest):
        return True
    src = legacy_db_path(root)
    if promote_file(src, dest):
        return db_is_ready(dest)
    return False


def build_query_index_sync(root: Optional[Path] = None) -> bool:
    """Run the indexer once into CODEGRAPH_DB_PATH when the query DB is empty.

    Used at agent startup so Code Explorer works without a manual Refresh when
    the image baked an empty placeholder DB. Returns True when the query DB is
    usable afterwards.
    """
    import subprocess
    import sys

    if ensure_query_index(root):
        return True
    src_root = root or repo_src_root()
    script = resolve_indexer_script(src_root)
    if script is None:
        logger.warning("CodeGraph auto-build skipped — indexer script not found")
        return False
    dest = query_db_path()
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.run(
            [sys.executable, str(script), "--out", str(dest)],
            cwd=str(src_root),
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except Exception as exc:
        logger.error("CodeGraph auto-build failed to launch: %s", exc)
        return False
    if proc.returncode != 0:
        logger.error(
            "CodeGraph auto-build exited %s:\n%s",
            proc.returncode,
            (proc.stdout or "")[-2000:],
        )
        return False
    if ensure_query_index(src_root) or db_is_ready(dest):
        logger.info("CodeGraph auto-build OK → %s", dest)
        return True
    logger.error("CodeGraph auto-build finished but query DB still empty at %s", dest)
    return False


def resolve_indexer_script(root: Optional[Path] = None) -> Optional[Path]:
    """Prefer the baked indexer (understands --out), then CODEGRAPH_INDEXER, then staged."""
    env = os.getenv("CODEGRAPH_INDEXER", "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.append(_BAKED_INDEXER)
    candidates.append((root or repo_src_root()) / "scripts" / "build-codegraph.py")
    for path in candidates:
        try:
            if path.is_file():
                return path
        except OSError:
            continue
    return None
