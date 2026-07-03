'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CODEBASE_ID = 'ai-demo2-default';
const DEFAULT_CODEBASE_NAME = 'This demo (AI-DEMO2)';

// Curated first-party source roots. Widen by editing this list.
const SOURCE_ROOTS = [
  'demo_api_server',
  'demo_api_ui/src',
  'demo_mcp_code_search/src',
  'langchain_agent',
  'demo_llm_proxy',
  'llamaindex_agent',
];

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
const MAX_FILES = 3000;

function walk(absDir, repoRoot, acc, skipped) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) {
      skipped.count++;
      if (!skipped.capWarned) {
        skipped.capWarned = true;
        console.warn(`[default-index] file cap (${MAX_FILES}) reached; indexing truncated`);
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

/** Pure: collect first-party source files under repoRoot, applying ignore + caps. */
function collectFiles(repoRoot) {
  const acc = [];
  const skipped = { count: 0 };
  for (const root of SOURCE_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs, repoRoot, acc, skipped);
  }
  acc._skipped = skipped.count; // stashed for the caller's status
  return acc;
}

const status = { state: 'idle', filesIndexed: 0, chunksCreated: 0, skipped: 0, error: null };
function getStatus() { return { ...status }; }

/** Idempotent background index of the repo into the default codebase. */
async function startDefaultIndex({ client, rootDir }) {
  if (status.state === 'indexing' || status.state === 'ready') return;
  status.state = 'indexing';
  try {
    // Idempotency: if the default codebase already has chunks, skip.
    try {
      const probe = await client.search({
        query: 'function', codebase_id: DEFAULT_CODEBASE_ID, limit: 1,
      });
      if (probe && Array.isArray(probe.results) && probe.results.length > 0) {
        status.state = 'ready';
        status.error = null;
        return;
      }
    } catch (_) { /* embedder/weaviate not ready yet — fall through to index */ }

    const files = collectFiles(rootDir);
    status.skipped = files._skipped || 0;

    // Batch to respect the code-search 60MB body limit (~400 files/batch).
    const BATCH = 400;
    let chunks = 0;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const res = await client.index({
        files: batch,
        codebase_id: DEFAULT_CODEBASE_ID,
        codebase_name: DEFAULT_CODEBASE_NAME,
        chunk_strategy: 'line-based',
      });
      chunks += (res && res.chunks_created) || 0;
    }
    status.filesIndexed = files.length;
    status.chunksCreated = chunks;
    status.state = 'ready';
    status.error = null;
    console.log(`[default-index] ready: ${files.length} files, ${chunks} chunks, ${status.skipped} skipped`);
  } catch (err) {
    status.state = 'error';
    status.error = err.message;
    console.error('[default-index] failed:', err.message);
  }
}

module.exports = {
  DEFAULT_CODEBASE_ID, DEFAULT_CODEBASE_NAME, SOURCE_ROOTS,
  collectFiles, getStatus, startDefaultIndex,
};
