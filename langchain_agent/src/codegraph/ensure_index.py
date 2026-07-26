# langchain_agent/src/codegraph/ensure_index.py
"""Keep the Code Explorer query DB path populated and hardened.

Failure modes this module heals:

1. Dockerfile `touch`es a zero-byte placeholder — queries would 503.
2. Stale/wrong-root indexes (paths under `live-repo/`) or host CodeGraph product
   DBs sharing `.codegraph/codegraph.db` — refused; rebuilt into demo-codegraph.db.
3. Missing builder marker — treated as unusable, never promoted from product DB.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from codegraph.db import CODEGRAPH_DB_PATH
from codegraph.index_guard import (
    DEMO_DB_NAME,
    index_is_usable,
    inspect_demo_index,
    require_demo_db_path,
)
from codegraph.repo import repo_src_root

logger = logging.getLogger(__name__)

# Baked into the agent image by the Dockerfile (always has --out support).
_BAKED_INDEXER = Path("/app/indexer/build-codegraph.py")


def query_db_path() -> Path:
    """Path the Code Explorer tools and `_index_available` read."""
    return Path(CODEGRAPH_DB_PATH)


def legacy_db_path(root: Optional[Path] = None) -> Path:
    """Demo-only legacy write path (never the host product codegraph.db)."""
    return (root or repo_src_root()) / ".codegraph" / DEMO_DB_NAME


def db_is_ready(path: Path) -> bool:
    """True when path exists and is non-empty (size only — not schema-safe)."""
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def promote_file(src: Path, dest: Path) -> bool:
    """Atomically copy src → dest. Returns True on success."""
    if not db_is_ready(src):
        return False
    # Never promote the host product DB or any DB lacking the demo builder marker.
    if src.name != DEMO_DB_NAME or not index_is_usable(src, require_scope=False):
        logger.warning(
            "CodeGraph refuse promote from %s (not a usable demo index)", src
        )
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
    """Ensure CODEGRAPH_DB_PATH is a usable demo index.

    Safe to call on every query/startup — no-op when already usable. Never
    promotes `.codegraph/codegraph.db` (host product). Returns True when the
    query DB passes hardening checks afterwards.
    """
    path_err = require_demo_db_path(query_db_path())
    if path_err:
        logger.error("CodeGraph %s", path_err)
        return False

    src_root = root or repo_src_root()
    dest = query_db_path()
    if index_is_usable(dest, repo_root=src_root):
        return True

    if db_is_ready(dest):
        info = inspect_demo_index(dest, repo_root=src_root)
        logger.warning(
            "CodeGraph query DB present but unusable (%s) — will rebuild",
            info.get("error"),
        )

    src = legacy_db_path(src_root)
    if src.resolve() != dest.resolve() and index_is_usable(src, repo_root=src_root):
        if promote_file(src, dest):
            return index_is_usable(dest, repo_root=src_root)
    return False


def build_query_index_sync(root: Optional[Path] = None) -> bool:
    """Run the indexer once into CODEGRAPH_DB_PATH when the query DB is unusable.

    Used at agent startup so Code Explorer works without a manual Refresh.
    Passes the source root explicitly so a baked `/app/indexer` copy cannot
    nest paths as `live-repo/...`.
    """
    import subprocess
    import sys

    if ensure_query_index(root):
        return True
    path_err = require_demo_db_path(query_db_path())
    if path_err:
        logger.error("CodeGraph auto-build blocked: %s", path_err)
        return False

    src_root = root or repo_src_root()
    script = resolve_indexer_script(src_root)
    if script is None:
        logger.warning("CodeGraph auto-build skipped — indexer script not found")
        return False
    dest = query_db_path()
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "REPO_SRC_ROOT": str(src_root)}
        # Never inherit a full-repo walk in docker/startup.
        env.pop("CODEGRAPH_INDEX_ALL", None)
        proc = subprocess.run(
            [sys.executable, str(script), str(src_root), "--out", str(dest)],
            cwd=str(src_root),
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
            env=env,
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

    info = inspect_demo_index(dest, repo_root=src_root)
    if info.get("ok"):
        logger.info(
            "CodeGraph auto-build OK → %s (ui=%s api=%s nodes=%s)",
            dest, info.get("uiFiles"), info.get("apiFiles"), info.get("nodes"),
        )
        return True
    logger.error(
        "CodeGraph auto-build finished but index unusable: %s", info.get("error")
    )
    return False


def resolve_indexer_script(root: Optional[Path] = None) -> Optional[Path]:
    """Prefer CODEGRAPH_INDEXER (live mount), then baked, then staged."""
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
