/**
 * Code Search API Routes
 * Proxies requests to the RAG Code Search MCP server
 *
 * Routes:
 *   POST /index - Index files for a codebase
 *   POST /search - Search across indexed codebases
 */

'use strict';

const express = require('express');
const multer = require('multer');
const MCPCodeSearchClient = require('../src/services/mcpCodeSearchClient');
const {
  getStatus: getDefaultIndexStatus,
  startDefaultIndex,
} = require('../services/defaultCodebaseIndexer');

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

// Get MCP server URL from env or use default
const mcpServerUrl = process.env.MCP_CODE_SEARCH_URL || 'http://localhost:8095';

// LlamaIndex agent service URL (POST /ask) — proxied by the /ask route below.
const LLAMAINDEX_AGENT_URL =
  process.env.LLAMAINDEX_AGENT_URL || 'http://llamaindex-agent:8894';

// Instantiate the client lazily on first use rather than at module load, so
// requiring this route (e.g. from server.js at startup or in tests) has no
// network-client construction side effect (axios.create()).
let mcpClient;
function getClient() {
  if (!mcpClient) mcpClient = new MCPCodeSearchClient(mcpServerUrl);
  return mcpClient;
}

/**
 * POST /api/code-search/index
 * Index files for a codebase
 *
 * Request:
 *   multipart/form-data with:
 *   - file (multiple files)
 *   - codebase_name (string)
 *   - codebase_id (string, optional - generated if not provided)
 *
 * Response: { codebase_id, files_indexed, chunks_created, errors? }
 */
router.post('/index', upload.array('file'), async (req, res) => {
  try {
    const { codebase_name, codebase_id } = req.body;

    // Validate required fields
    if (!codebase_name) {
      return res.status(400).json({
        error: 'missing_codebase_name',
        message: 'codebase_name is required',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'no_files',
        message: 'At least one file is required',
      });
    }

    // Generate codebase_id if not provided
    const finalCodebaseId = codebase_id || `codebase_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Convert multer files to the format MCP expects
    const files = req.files.map((file) => ({
      path: file.originalname || `file_${Date.now()}`,
      content: file.buffer.toString('utf8'),
    }));

    // Call MCP server to index
    const result = await getClient().index({
      files,
      codebase_id: finalCodebaseId,
      codebase_name,
      chunk_strategy: 'line-based',
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[code-search] Index error:', err.message);

    if (err.message.includes('unavailable')) {
      return res.status(503).json({
        error: 'mcp_server_unavailable',
        message: err.message,
      });
    }

    return res.status(500).json({
      error: 'index_failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/code-search/search
 * Search across indexed codebases
 *
 * Request: { query, codebase_id, limit?, file_filter? }
 * Response: { results, query_time_ms }
 */
router.post('/search', express.json(), async (req, res) => {
  try {
    const { query, codebase_id, limit, file_filter } = req.body;

    // Validate required fields
    if (!query) {
      return res.status(400).json({
        error: 'missing_query',
        message: 'query is required',
      });
    }

    if (!codebase_id) {
      return res.status(400).json({
        error: 'missing_codebase_id',
        message: 'codebase_id is required',
      });
    }

    // Call MCP server to search
    const result = await getClient().search({
      query,
      codebase_id,
      limit: limit || 10,
      file_filter,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[code-search] Search error:', err.message);

    if (err.message.includes('unavailable')) {
      return res.status(503).json({
        error: 'mcp_server_unavailable',
        message: err.message,
      });
    }

    return res.status(500).json({
      error: 'search_failed',
      message: err.message,
    });
  }
});

/** GET /api/code-search/default-status — background default-index progress. */
router.get('/default-status', (_req, res) => {
  res.status(200).json(getDefaultIndexStatus());
});

/**
 * POST /api/code-search/ask
 * Proxy to the LlamaIndex agent service's POST /ask.
 *
 * Request: { question, codebase_id, limit? }
 * Response: whatever the agent service returns (e.g. { answer, sources, toolCalls, mode }).
 */
router.post('/ask', express.json(), async (req, res) => {
  const { question, codebase_id, limit } = req.body || {};
  if (!question) return res.status(400).json({ error: 'missing_question' });
  if (!codebase_id) return res.status(400).json({ error: 'missing_codebase_id' });
  // Bound the agent call so a slow/hung LLM doesn't wedge the request forever.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(`${LLAMAINDEX_AGENT_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, codebase_id, limit }),
      signal: ctrl.signal,
    });
    const body = await r.json().catch(() => ({}));
    const status = typeof r.status === 'number' ? r.status : (r.ok ? 200 : 502);
    return res.status(status).json(body);
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return res.status(aborted ? 504 : 503).json({
      error: aborted ? 'agent_timeout' : 'agent_unavailable',
      message: aborted ? 'The agent took too long to respond.' : err.message,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// Kick off the default index once, in the background, gated on the embedder.
// Skipped under NODE_ENV=test so requiring this router in jest doesn't arm a
// stray timer that fires after the suite finishes.
if (
  process.env.CODE_SEARCH_DEFAULT_INDEX !== 'false' &&
  process.env.NODE_ENV !== 'test' &&
  !global.__defaultIndexStarted
) {
  global.__defaultIndexStarted = true;
  const rootDir = process.env.CODE_SEARCH_REPO_ROOT || '/repo';
  const tryStart = async (attempt = 0) => {
    try {
      await startDefaultIndex({ client: getClient(), rootDir });
    } catch {
      // startDefaultIndex normally swallows its own errors (sets state:'error'),
      // so this catch is a belt-and-suspenders path only.
    }
    // startDefaultIndex reports failure via status, not by throwing, so gate the
    // embedder-warmup retry on the resulting state — otherwise a cold-start
    // failure (embedder still warming) would never retry.
    const st = getDefaultIndexStatus();
    if (st.state === 'error') {
      if (attempt < 30) {
        setTimeout(() => tryStart(attempt + 1), 10000); // retry until embedder is up
      } else {
        console.error('[default-index] gave up after retries:', st.error);
      }
    }
  };
  // Delay first attempt so the server finishes booting first.
  setTimeout(() => tryStart(), 5000);
}

module.exports = router;
