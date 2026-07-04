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

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

// Get MCP server URL from env or use default
const mcpServerUrl = process.env.MCP_CODE_SEARCH_URL || 'http://localhost:8095';

// Instantiate the client lazily on first use rather than at module load, so
// requiring this route (e.g. from server.js at startup or in tests) has no
// network-client construction side effect (axios.create()).
let mcpClient;
function getClient() {
  if (!mcpClient) mcpClient = new MCPCodeSearchClient(mcpServerUrl);
  return mcpClient;
}

/**
 * Shared error responder for every code-search route: the client marks
 * outages (HTTP 503 or network-level failure) with err.status === 503, which
 * maps to 503 mcp_server_unavailable; anything else is a 500 with the
 * route-specific error code.
 */
function sendCodeSearchError(res, err, errorCode, label) {
  console.error(`[code-search] ${label} error:`, err.message);
  if (err.status === 503) {
    return res.status(503).json({
      error: 'mcp_server_unavailable',
      message: err.message,
    });
  }
  return res.status(500).json({
    error: errorCode,
    message: err.message,
  });
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
    return sendCodeSearchError(res, err, 'index_failed', 'Index');
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
    return sendCodeSearchError(res, err, 'search_failed', 'Search');
  }
});

/**
 * GET /api/code-search/codebases
 * List the codebases currently indexed in the vector store, so the UI can show
 * them regardless of per-browser localStorage.
 *
 * Response: { codebases: [{ id, name, chunks }] }
 */
router.get('/codebases', async (_req, res) => {
  try {
    const result = await getClient().listCodebases();
    return res.status(200).json(result);
  } catch (err) {
    return sendCodeSearchError(res, err, 'list_failed', 'List codebases');
  }
});

module.exports = router;
