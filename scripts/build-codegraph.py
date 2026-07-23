#!/usr/bin/env python3
"""
build-codegraph.py — index the AI-Demo repo into .codegraph/demo-codegraph.db

Walks .py / .js/.ts/.jsx/.tsx under the resolved repo root and builds a SQLite
database that the langchain_agent's Code Explorer tools query:

  nodes  — functions, classes, methods (id, kind, name, qualified_name,
            file_path, start_line, end_line, signature, docstring)
  edges  — call relationships between nodes (source, target, kind, line)
  nodes_fts — FTS5 virtual table over name + qualified_name + docstring + signature

By default only demo_api_ui + demo_api_server are indexed (Code Explorer focus).
Use --all to walk the full tree. The DB filename is demo-codegraph.db so it does
not collide with the host CodeGraph product daemon at .codegraph/codegraph.db.

Only stdlib is required (ast, sqlite3, pathlib, re). No pip installs needed.

Usage (from repo root):
  python3 scripts/build-codegraph.py           # UI + API → .codegraph/demo-codegraph.db
  python3 scripts/build-codegraph.py --all     # whole repo (minus SKIP_DIRS)
  python3 scripts/build-codegraph.py --dry-run # print stats, don't write db
  python3 scripts/build-codegraph.py /path/to/root --out /path/to/db
  python3 scripts/build-codegraph.py --help

Root resolution order: positional path → REPO_SRC_ROOT → directory of this script's repo.
"""

import ast
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
# Separate from the host CodeGraph product DB (.codegraph/codegraph.db).
DB_PATH   = REPO_ROOT / '.codegraph' / 'demo-codegraph.db'

# Directories to skip entirely
SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.codegraph', 'graphify-out', '.planning', 'dist', 'build', 'coverage',
    'certs', 'data', 'logs',
    'repo-src',  # repo-src = the staged source duplicate shipped into the agent image; never re-index or re-stage it.
    'live-repo',  # docker bind-mount of the host repo under /app; never nest-index it.
}

# Code Explorer default scope — full-repo walks are large and noisy for demos.
DEFAULT_INCLUDE_DIRS = ('demo_api_ui', 'demo_api_server')

# File extensions to index
PY_EXTS  = {'.py'}
JS_EXTS  = {'.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx'}


# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,        -- 'function' | 'class' | 'method'
    name          TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    start_line    INTEGER NOT NULL,
    end_line      INTEGER NOT NULL,
    signature     TEXT,
    docstring     TEXT
);

CREATE TABLE IF NOT EXISTS edges (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    source INTEGER NOT NULL REFERENCES nodes(id),
    target INTEGER NOT NULL REFERENCES nodes(id),
    kind   TEXT NOT NULL DEFAULT 'calls',
    line   INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, name, qualified_name, docstring, signature)
    VALUES (new.id, new.name, new.qualified_name,
            COALESCE(new.docstring, ''), COALESCE(new.signature, ''));
END;

CREATE TABLE IF NOT EXISTS project_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


# ── Python indexer (uses ast) ─────────────────────────────────────────────────

class PythonIndexer(ast.NodeVisitor):
    def __init__(self, file_path: str, rel_path: str):
        self.file_path = file_path
        self.rel_path  = rel_path
        self.nodes: list[dict] = []
        self.calls:  list[dict] = []   # {caller_qname, callee_name, line}
        self._scope: list[str] = []    # class/function nesting stack

    def _qname(self, name: str) -> str:
        parts = [p for p in self._scope if p] + [name]
        module = self.rel_path.replace(os.sep, '.').removesuffix('.py')
        return f"{module}.{'.'.join(parts)}"

    def _signature(self, node) -> str:
        try:
            args = []
            for arg in node.args.args:
                args.append(arg.arg)
            if node.args.vararg:
                args.append(f'*{node.args.vararg.arg}')
            if node.args.kwarg:
                args.append(f'**{node.args.kwarg.arg}')
            return f"def {node.name}({', '.join(args)})"
        except Exception:
            return f"def {node.name}(...)"

    def _docstring(self, node) -> Optional[str]:
        try:
            if (node.body and isinstance(node.body[0], ast.Expr) and
                    isinstance(node.body[0].value, ast.Constant) and
                    isinstance(node.body[0].value.value, str)):
                doc = node.body[0].value.value.strip()
                return doc[:500] if doc else None
        except Exception:
            pass
        return None

    def visit_ClassDef(self, node: ast.ClassDef):
        qname = self._qname(node.name)
        self.nodes.append({
            'kind': 'class',
            'name': node.name,
            'qualified_name': qname,
            'file_path': self.rel_path,
            'start_line': node.lineno,
            'end_line': node.end_lineno or node.lineno,
            'signature': f"class {node.name}",
            'docstring': self._docstring(node),
        })
        self._scope.append(node.name)
        self.generic_visit(node)
        self._scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self._visit_func(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self._visit_func(node)

    def _visit_func(self, node):
        kind = 'method' if self._scope else 'function'
        qname = self._qname(node.name)
        self.nodes.append({
            'kind': kind,
            'name': node.name,
            'qualified_name': qname,
            'file_path': self.rel_path,
            'start_line': node.lineno,
            'end_line': node.end_lineno or node.lineno,
            'signature': self._signature(node),
            'docstring': self._docstring(node),
        })
        self._scope.append(node.name)
        # Collect calls inside this function
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                callee = None
                if isinstance(child.func, ast.Name):
                    callee = child.func.id
                elif isinstance(child.func, ast.Attribute):
                    callee = child.func.attr
                if callee:
                    self.calls.append({'caller_qname': qname, 'callee_name': callee, 'line': child.lineno})
        self.generic_visit(node)
        self._scope.pop()


def index_python_file(path: Path, rel: str) -> tuple[list[dict], list[dict]]:
    try:
        source = path.read_text(encoding='utf-8', errors='replace')
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return [], []
    indexer = PythonIndexer(str(path), rel)
    indexer.visit(tree)
    return indexer.nodes, indexer.calls


# ── JavaScript / TypeScript indexer (regex-based) ────────────────────────────
#
# Uses regex rather than a full AST parser so we avoid needing tree-sitter.
# Captures: function declarations, arrow functions assigned to const/let/var,
# class declarations, and class methods.

_JS_CLASS_RE   = re.compile(r'^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)', re.MULTILINE)
_JS_FUNC_RE    = re.compile(
    r'^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)',
    re.MULTILINE)
_JS_ARROW_RE   = re.compile(
    r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>', re.MULTILINE)
_JS_METHOD_RE  = re.compile(
    r'^\s+(?:async\s+|static\s+|private\s+|public\s+|protected\s+)*(\w+)\s*\(([^)]*)\)\s*(?::\s*\w[\w<>, |]*?)?\s*\{',
    re.MULTILINE)


def index_js_file(path: Path, rel: str) -> tuple[list[dict], list[dict]]:
    try:
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    except Exception:
        return [], []

    source = '\n'.join(lines)
    nodes = []
    module = rel.replace(os.sep, '.')
    # strip extension
    for ext in ('.js', '.ts', '.mjs', '.cjs'):
        module = module.removesuffix(ext)

    def lineno_of(match) -> int:
        return source[:match.start()].count('\n') + 1

    # Classes
    current_class = None
    for m in _JS_CLASS_RE.finditer(source):
        name = m.group(1)
        ln = lineno_of(m)
        current_class = name
        nodes.append({
            'kind': 'class',
            'name': name,
            'qualified_name': f"{module}.{name}",
            'file_path': rel,
            'start_line': ln,
            'end_line': ln,
            'signature': f"class {name}",
            'docstring': None,
        })

    # Top-level functions
    for m in _JS_FUNC_RE.finditer(source):
        name = m.group(1)
        ln = lineno_of(m)
        nodes.append({
            'kind': 'function',
            'name': name,
            'qualified_name': f"{module}.{name}",
            'file_path': rel,
            'start_line': ln,
            'end_line': ln,
            'signature': f"function {name}({m.group(2)})",
            'docstring': None,
        })

    # Arrow functions
    for m in _JS_ARROW_RE.finditer(source):
        name = m.group(1)
        ln = lineno_of(m)
        nodes.append({
            'kind': 'function',
            'name': name,
            'qualified_name': f"{module}.{name}",
            'file_path': rel,
            'start_line': ln,
            'end_line': ln,
            'signature': f"const {name} = (...) =>",
            'docstring': None,
        })

    # JS/TS edges not resolved (no full AST) — skip for now
    return nodes, []


# ── Walk repo ─────────────────────────────────────────────────────────────────

def _walk_roots(root: Path, include_dirs: Optional[Sequence[str]]) -> list[Path]:
    """Resolve which directories to walk under root.

    When include_dirs is set and at least one exists, walk only those (paths in
    the DB stay relative to root). If none exist (tiny test fixtures), fall back
    to the full tree so unit tests keep working.
    """
    if not include_dirs:
        return [root]
    existing = [root / d for d in include_dirs if (root / d).is_dir()]
    return existing or [root]


def collect_files(
    root: Path,
    include_dirs: Optional[Sequence[str]] = None,
) -> list[tuple[Path, str]]:
    results = []
    for walk_root in _walk_roots(root, include_dirs):
        for dirpath, dirnames, filenames in os.walk(walk_root):
            # Prune skip dirs in-place
            dirnames[:] = [
                d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')
            ]
            for fname in filenames:
                p = Path(dirpath) / fname
                ext = p.suffix.lower()
                if ext in PY_EXTS or ext in JS_EXTS:
                    rel = str(p.relative_to(root))
                    results.append((p, rel))
    return results


# ── Build provenance ──────────────────────────────────────────────────────────

def _repo_commit(root):
    try:
        out = subprocess.run(
            ['git', '-C', str(root), 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or 'unknown'
    except Exception:
        return 'unknown'


# Marker so Code Explorer can refuse the host CodeGraph product DB that shares
# the `.codegraph/` bind mount. Keep in sync with codegraph/index_guard.py.
BUILDER_ID = 'demo-build-codegraph'
BUILDER_VERSION = '1'


def write_metadata(conn, root):
    node_count = conn.execute('SELECT COUNT(*) FROM nodes').fetchone()[0]
    rows = {
        'builder': BUILDER_ID,
        'builder_version': BUILDER_VERSION,
        'built_at_commit': _repo_commit(root),
        'node_count': str(node_count),
        'built_at': datetime.now(timezone.utc).isoformat(),
    }
    for k, v in rows.items():
        conn.execute(
            'INSERT INTO project_metadata(key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            (k, v),
        )
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def build(
    dry_run: bool = False,
    out: Optional[Path] = None,
    root: Optional[Path] = None,
    include_dirs: Optional[Sequence[str]] = DEFAULT_INCLUDE_DIRS,
):
    """Index source under root into out (default: demo-codegraph.db).

    include_dirs defaults to UI + API Server. Pass None (or use --all) for the
    full tree. file_path values are always relative to root so they resolve
    under REPO_SRC_ROOT for grep/read_file.
    """
    src_root = Path(root) if root is not None else REPO_ROOT
    # Prefer explicit --out, then module DB_PATH (tests monkeypatch this), then
    # <root>/.codegraph/demo-codegraph.db when indexing a non-default root.
    if out is not None:
        db_path = Path(out)
    elif root is not None and Path(root).resolve() != REPO_ROOT.resolve():
        db_path = src_root / '.codegraph' / 'demo-codegraph.db'
    else:
        db_path = DB_PATH
    files = collect_files(src_root, include_dirs=include_dirs)
    scope = ','.join(include_dirs) if include_dirs else 'all'
    print(f'  Indexing {len(files)} files from {src_root} (scope={scope})')

    all_nodes: list[dict] = []
    all_calls: list[dict] = []

    for path, rel in files:
        ext = path.suffix.lower()
        if ext in PY_EXTS:
            nodes, calls = index_python_file(path, rel)
        else:
            nodes, calls = index_js_file(path, rel)
        all_nodes.extend(nodes)
        all_calls.extend(calls)

    print(f'  Found {len(all_nodes)} nodes, {len(all_calls)} call sites')

    if dry_run:
        print('  (dry-run — not writing database)')
        return

    db_path.parent.mkdir(parents=True, exist_ok=True)
    # Build into a temp file, then atomically swap it into place. Concurrent
    # readers (the live Code Explorer agent) open the db read-only per query, so
    # an unlink-then-rebuild would expose a missing/half-written file mid-run;
    # os.replace() makes the cutover atomic on the same filesystem.
    tmp_path = db_path.with_name(db_path.name + '.tmp')
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    try:
        conn.executescript(SCHEMA)

        # Insert nodes
        conn.executemany(
            'INSERT INTO nodes (kind, name, qualified_name, file_path, start_line, end_line, signature, docstring) '
            'VALUES (:kind, :name, :qualified_name, :file_path, :start_line, :end_line, :signature, :docstring)',
            all_nodes,
        )
        conn.commit()

        # Build name → id index for edge resolution
        name_to_ids: dict[str, list[int]] = {}
        for row in conn.execute('SELECT id, name FROM nodes'):
            name_to_ids.setdefault(row[1], []).append(row[0])

        qname_to_id: dict[str, int] = {}
        for row in conn.execute('SELECT id, qualified_name FROM nodes'):
            qname_to_id[row[1]] = row[0]

        # Insert edges
        edges_inserted = 0
        for call in all_calls:
            source_id = qname_to_id.get(call['caller_qname'])
            if source_id is None:
                continue
            targets = name_to_ids.get(call['callee_name'], [])
            for target_id in targets[:3]:  # cap fan-out per call site
                conn.execute(
                    'INSERT INTO edges (source, target, kind, line) VALUES (?, ?, ?, ?)',
                    (source_id, target_id, 'calls', call['line']),
                )
                edges_inserted += 1
        conn.commit()
        write_metadata(conn, src_root)
    finally:
        conn.close()

    os.replace(tmp_path, db_path)

    print(f'  Wrote {edges_inserted} edges')
    print(f'  Database: {db_path}')


def stage_source(root: Path, dest: Path) -> int:
    """Copy every indexed source file into dest, preserving relative paths."""
    # Resolve dest so we can prune it from the walk when it lives inside root.
    dest_resolved = dest.resolve()
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        cur = Path(dirpath).resolve()
        # Skip the destination dir itself (and its children) to avoid
        # infinite recursion when dest is nested under root.
        if cur == dest_resolved or str(cur).startswith(str(dest_resolved) + os.sep):
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in (PY_EXTS | JS_EXTS):
                rel = p.relative_to(root)
                out = dest / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, out)
                count += 1
    return count


def main():
    args = sys.argv[1:]

    if '--help' in args or '-h' in args:
        print(__doc__)
        sys.exit(0)

    dry_run = '--dry-run' in args
    # Full-repo walks are opt-in only (--all or CODEGRAPH_INDEX_ALL=1). Docker
    # compose must not set that env — default stays UI + API Server.
    env_all = os.getenv('CODEGRAPH_INDEX_ALL', '').strip().lower() in (
        '1', 'true', 'yes',
    )
    index_all = '--all' in args or env_all

    # Optional positional root: first arg that doesn't start with '-' and
    # is not the value token of a named flag (e.g. --stage-src <DIR>).
    # Skip value tokens so `--stage-src langchain_agent/repo-src` doesn't
    # accidentally override root.
    _flag_value_tokens: set = set()
    for flag in ('--stage-src', '--out'):
        _fi = args.index(flag) if flag in args else -1
        if _fi >= 0 and _fi + 1 < len(args):
            _flag_value_tokens.add(args[_fi + 1])

    # Prefer REPO_SRC_ROOT (docker live mount) over the script's parent repo so
    # a baked copy at /app/indexer/build-codegraph.py still indexes /app/live-repo
    # instead of nesting paths under /app/live-repo/... .
    env_root = os.getenv('REPO_SRC_ROOT', '').strip()
    root = Path(env_root).resolve() if env_root else REPO_ROOT
    for arg in args:
        if not arg.startswith('-') and arg not in _flag_value_tokens:
            root = Path(arg).resolve()
            break

    # --stage-src <DIR>
    stage_dir = None
    if '--stage-src' in args:
        idx = args.index('--stage-src')
        if idx + 1 < len(args):
            stage_dir = Path(args[idx + 1]).resolve()

    if stage_dir is not None:
        count = stage_source(root, stage_dir)
        print(f'  Staged {count} source files into {stage_dir}')
        sys.exit(0)

    # --out <PATH> — override the output db path (default: <root>/.codegraph/demo-codegraph.db)
    out_path = None
    if '--out' in args:
        idx = args.index('--out')
        if idx + 1 < len(args):
            out_path = Path(args[idx + 1]).resolve()

    include = None if index_all else DEFAULT_INCLUDE_DIRS
    if out_path is None and root.resolve() != REPO_ROOT.resolve():
        out_path = root / '.codegraph' / 'demo-codegraph.db'
    build(dry_run=dry_run, out=out_path, root=root, include_dirs=include)


if __name__ == '__main__':
    main()
