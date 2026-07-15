'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Default demo index is split into selectable pieces so /code-search stays
 * usable when the full repo is too large for one codebase. Each piece is its
 * own Weaviate codebase_id and appears in the left-rail picker.
 *
 * Legacy monolith id (kept for exports / older clients):
 */
const DEFAULT_CODEBASE_ID = 'ai-demo2-default';
const DEFAULT_CODEBASE_NAME = 'This demo (AI-DEMO2)';

/** @typedef {{ id: string, name: string, roots: string[] }} CodebasePiece */

/** Curated first-party packages. Widen by editing this list. */
const CODEBASE_PIECES = [
  { id: 'ai-demo2-ui', name: 'UI', roots: ['demo_api_ui/src'] },
  { id: 'ai-demo2-server', name: 'API Server', roots: ['demo_api_server'] },
  { id: 'ai-demo2-mcp-server', name: 'MCP Server', roots: ['demo_mcp_server'] },
  { id: 'ai-demo2-mcp-gateway', name: 'MCP Gateway', roots: ['demo_mcp_gateway'] },
  { id: 'ai-demo2-authorize', name: 'Authorize', roots: ['demo_authz_server'] },
  { id: 'ai-demo2-ping-gateway', name: 'Ping Gateway', roots: ['ping-gateway'] },
  { id: 'ai-demo2-hitl', name: 'HITL', roots: ['demo_hitl_service'] },
  {
    id: 'ai-demo2-agents',
    name: 'Agents',
    roots: [
      'langchain_agent',
      'llamaindex_agent',
      'openai_agent',
      'pydantic_agent',
      'mastra_agent',
    ],
  },
  { id: 'ai-demo2-llm-proxy', name: 'LLM Proxy', roots: ['demo_llm_proxy'] },
  {
    id: 'ai-demo2-code-search',
    name: 'Code Search',
    roots: ['demo_mcp_code_search/src'],
  },
];

/** Flat union of piece roots — used by tests and any caller wanting all files. */
const SOURCE_ROOTS = CODEBASE_PIECES.flatMap((p) => p.roots);

const IGNORE_DIR = new Set([
  'node_modules', '.git', '.claude', 'dist', 'build', 'coverage',
  'data', 'logs', '.next', '__pycache__', '.venv', 'venv',
  'repo-src', 'certs',
]);
const IGNORE_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.min\.(js|css)|package-lock\.json|yarn\.lock|.*\.pem|.*\.key|.*\.p12|.*\.crt)$/i;
const ALLOW_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.md', '.css', '.scss',
  '.yml', '.yaml', '.sh', '.go', '.java', '.rb', '.rs', '.txt', '.html',
]);

const MAX_FILE_BYTES = 256 * 1024;
/** Per-piece file cap (was a single 3000 for the whole monolith). */
const MAX_FILES_PER_PIECE = 1500;

/**
 * Walk one directory tree, collecting code files under repo-relative paths.
 * @param {string} absDir
 * @param {string} repoRoot
 * @param {Array<{path: string, content: string}>} acc
 * @param {{ count: number, capWarned?: boolean, maxFiles: number }} skipped
 */
function walk(absDir, repoRoot, acc, skipped) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (acc.length >= skipped.maxFiles) {
      skipped.count++;
      if (!skipped.capWarned) {
        skipped.capWarned = true;
        console.warn(
          `[default-index] file cap (${skipped.maxFiles}) reached; indexing truncated`
        );
      }
      return;
    }
    const abs = path.join(absDir, e.name);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (IGNORE_DIR.has(e.name)) { continue; }
      walk(abs, repoRoot, acc, skipped);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!ALLOW_EXT.has(ext) || IGNORE_FILE_RE.test(rel)) { skipped.count++; continue; }
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped.count++; continue; }
      if (stat.size > MAX_FILE_BYTES) { skipped.count++; continue; }
      let content;
      try { content = fs.readFileSync(abs, 'utf8'); } catch { skipped.count++; continue; }
      acc.push({ path: rel, content });
    }
  }
}

/**
 * Pure: collect first-party source files under repoRoot for the given roots
 * (defaults to all piece roots).
 * @param {string} repoRoot
 * @param {string[]} [roots]
 */
function collectFiles(repoRoot, roots = SOURCE_ROOTS) {
  const acc = [];
  const skipped = { count: 0, maxFiles: MAX_FILES_PER_PIECE };
  for (const root of roots) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs, repoRoot, acc, skipped);
  }
  acc._skipped = skipped.count;
  return acc;
}

/**
 * @typedef {{
 *   state: 'idle'|'indexing'|'ready'|'error'|'skipped',
 *   filesIndexed: number,
 *   chunksCreated: number,
 *   skipped: number,
 *   error: string|null
 * }} PieceStatus
 */

const status = {
  state: 'idle',
  filesIndexed: 0,
  chunksCreated: 0,
  skipped: 0,
  error: null,
  /** @type {Record<string, PieceStatus>} */
  pieces: {},
};

/** Return a shallow copy of the aggregate indexer status (incl. per-piece). */
function getStatus() {
  return {
    ...status,
    pieces: { ...status.pieces },
    pieceIds: CODEBASE_PIECES.map((p) => p.id),
  };
}

/**
 * Probe whether a codebase already has indexed chunks.
 * @param {{ search: Function }} client
 * @param {string} codebaseId
 */
async function hasChunks(client, codebaseId) {
  try {
    const probe = await client.search({
      query: 'function',
      codebase_id: codebaseId,
      limit: 1,
    });
    return !!(probe && Array.isArray(probe.results) && probe.results.length > 0);
  } catch (_) {
    return false;
  }
}

/**
 * Index one piece in small batches.
 * @param {{ index: Function }} client
 * @param {CodebasePiece} piece
 * @param {string} rootDir
 */
async function indexPiece(client, piece, rootDir) {
  const pieceStatus = {
    state: 'indexing',
    filesIndexed: 0,
    chunksCreated: 0,
    skipped: 0,
    error: null,
  };
  status.pieces[piece.id] = pieceStatus;

  if (await hasChunks(client, piece.id)) {
    pieceStatus.state = 'ready';
    return pieceStatus;
  }

  const presentRoots = piece.roots.filter((r) =>
    fs.existsSync(path.join(rootDir, r))
  );
  if (presentRoots.length === 0) {
    pieceStatus.state = 'skipped';
    return pieceStatus;
  }

  const files = collectFiles(rootDir, presentRoots);
  pieceStatus.skipped = files._skipped || 0;

  const BATCH = 50;
  let chunks = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const res = await client.index({
      files: batch,
      codebase_id: piece.id,
      codebase_name: piece.name,
      chunk_strategy: 'line-based',
    });
    chunks += (res && res.chunks_created) || 0;
  }
  pieceStatus.filesIndexed = files.length;
  pieceStatus.chunksCreated = chunks;
  pieceStatus.state = 'ready';
  return pieceStatus;
}

/**
 * Idempotent background index of the repo into one codebase per piece.
 * @param {{ client: { index: Function, search: Function }, rootDir: string }} opts
 */
async function startDefaultIndex({ client, rootDir }) {
  if (status.state === 'indexing' || status.state === 'ready') return;
  status.state = 'indexing';
  status.error = null;
  try {
    // Fast path: if every present piece already has chunks, mark ready.
    let allReady = true;
    for (const piece of CODEBASE_PIECES) {
      const present = piece.roots.some((r) =>
        fs.existsSync(path.join(rootDir, r))
      );
      if (!present) {
        status.pieces[piece.id] = {
          state: 'skipped',
          filesIndexed: 0,
          chunksCreated: 0,
          skipped: 0,
          error: null,
        };
        continue;
      }
      if (!(await hasChunks(client, piece.id))) {
        allReady = false;
        break;
      }
      status.pieces[piece.id] = {
        state: 'ready',
        filesIndexed: 0,
        chunksCreated: 0,
        skipped: 0,
        error: null,
      };
    }
    if (allReady && Object.keys(status.pieces).length > 0) {
      status.state = 'ready';
      return;
    }

    let totalFiles = 0;
    let totalChunks = 0;
    let totalSkipped = 0;
    for (const piece of CODEBASE_PIECES) {
      const ps = await indexPiece(client, piece, rootDir);
      totalFiles += ps.filesIndexed || 0;
      totalChunks += ps.chunksCreated || 0;
      totalSkipped += ps.skipped || 0;
    }
    status.filesIndexed = totalFiles;
    status.chunksCreated = totalChunks;
    status.skipped = totalSkipped;
    status.state = 'ready';
    status.error = null;
    console.log(
      `[default-index] ready: ${CODEBASE_PIECES.length} pieces, ` +
        `${totalFiles} files, ${totalChunks} chunks, ${totalSkipped} skipped`
    );
  } catch (err) {
    status.state = 'error';
    status.error = err.message;
    console.error('[default-index] failed:', err.message);
  }
}

/** Test-only: clear module status so suites can re-invoke startDefaultIndex. */
function _resetStatusForTests() {
  status.state = 'idle';
  status.filesIndexed = 0;
  status.chunksCreated = 0;
  status.skipped = 0;
  status.error = null;
  status.pieces = {};
}

module.exports = {
  DEFAULT_CODEBASE_ID,
  DEFAULT_CODEBASE_NAME,
  CODEBASE_PIECES,
  SOURCE_ROOTS,
  collectFiles,
  getStatus,
  startDefaultIndex,
  _resetStatusForTests,
};
