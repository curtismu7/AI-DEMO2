'use strict';
/**
 * reports.js — Run report generation, history, and sharing endpoints.
 *
 * Routes:
 *   POST   /generate              Generate report for a runId (authenticated)
 *   GET    /history               User's own run history (authenticated)
 *   GET    /history/all           All runs (admin only)
 *   GET    /:runId/download       Download report file (authenticated)
 *   GET    /:runId/share          Get shareable link (authenticated)
 *   GET    /shared/:token         Download via share token (unauthenticated)
 *   POST   /bulk                  Bulk export (admin only)
 *
 * Accessible to ALL logged-in users (not admin-only).
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { authenticateToken, requireAdmin, requireScopes } = require('../middleware/auth');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const reportShareStore = require('../services/lmdb/reportShareStore.lmdb');
const { formatMarkdown, formatHtml, formatPdf } = require('../services/reportFormatter');
const { getMCPToolCalls, getTokenChain } = require('../services/tokenChainService');

const router = express.Router();

// Writable cache dir for generated report files. The in-repo docs/reports path
// works locally, but the container image flattens code to /app, so the same
// relative path resolves to an unwritable /docs/reports for the non-root user —
// every on-the-fly download then 500'd with EACCES. Fall back to the OS temp dir
// when the repo dir isn't writable. These files are only a cache; downloads
// regenerate them when absent.
const REPORTS_DIR = (() => {
  const repoDir = path.join(__dirname, '../../docs/reports');
  try {
    fs.mkdirSync(repoDir, { recursive: true });
    fs.accessSync(repoDir, fs.constants.W_OK);
    return repoDir;
  } catch (_e) {
    const tmpDir = path.join(os.tmpdir(), 'ai-demo-reports');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_e2) { /* noop */ }
    return tmpDir;
  }
})();

// Share token → run mapping. In-memory Map is a cache over LMDB
// (reportShareStore) so a shared link survives a restart until it expires.
const shareTokens = new Map();
const SHARE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic cleanup of expired share tokens (memory + LMDB).
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of shareTokens) {
    if (now >= entry.expiresAt) {
      shareTokens.delete(token);
      reportShareStore.remove(token);
    }
  }
  for (const [token, entry] of reportShareStore.loadAll()) {
    if (entry && entry.expiresAt && now >= entry.expiresAt) reportShareStore.remove(token);
  }
}, 60 * 60 * 1000).unref();

// Fetch live MCP tool call events and attach to run record before formatting.
// Best-effort: a fetch failure just leaves mcpToolCallsChain as [].
async function withMcpChain(run) {
  try {
    const chain = await getMCPToolCalls(run.userId);
    return Object.assign({}, run, { mcpToolCallsChain: chain || [] });
  } catch (_e) {
    return Object.assign({}, run, { mcpToolCallsChain: [] });
  }
}

// True when a run's persisted tokenEvents already carry a CIBA step-up.
function runEventsHaveCiba(run) {
  return (run.tokenEvents || []).some((e) => e.grantedVia === 'ciba');
}

// CIBA step-up approvals are recorded by routes/ciba.js poll success into
// tokenChainService's in-memory per-user chain (keyed off the structured
// grantedVia flag) — a separate store from the run record's tokenEvents (which
// come from the agent pipeline). So a run never carries the CIBA event itself.
// Bridge the two here: a run "has a CIBA step-up" if the user approved one
// within that run's window [startedAt, completedAt] (CIBA TTL when completedAt
// is absent). Returns CIBA-approval epoch-ms timestamps for a user; cached per
// request so listAllRuns over many runs hits getTokenChain once per user.
async function cibaStepUpTimestamps(userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  let stamps = [];
  try {
    const chain = await getTokenChain(userId);
    stamps = (chain || [])
      .filter((e) => e.grantedVia === 'ciba' && e.timestamp)
      .map((e) => Date.parse(e.timestamp))
      .filter((n) => !Number.isNaN(n));
  } catch (_e) { /* best-effort: in-memory chain may be empty after a restart */ }
  cache.set(userId, stamps);
  return stamps;
}

const STEP_UP_WINDOW_MS = 5 * 60 * 1000; // CIBA step-up TTL (routes/ciba.js)

// Lets the history table badge step-up runs.
async function hasCibaStepUp(run, cache) {
  if (runEventsHaveCiba(run)) return true;
  // Without a userId we cannot scope the lookup — getTokenChain(undefined)
  // returns EVERY user's events, which would false-positive the badge on legacy
  // runs that predate the userId field. Bail out instead.
  if (!run.userId) return false;
  const start = Date.parse(run.startedAt || '');
  if (Number.isNaN(start)) return false;
  // Use the parsed value unless NaN (don't let a valid epoch-0 fall through).
  const completed = Date.parse(run.completedAt || '');
  const end = Number.isNaN(completed) ? start + STEP_UP_WINDOW_MS : completed;
  const stamps = await cibaStepUpTimestamps(run.userId, cache);
  return stamps.some((t) => t >= start && t <= end);
}

function formatFilename(vertical, ext) {
  const date = new Date()
    .toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .slice(0, 19);
  const safeVertical = String(vertical).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
  return `${safeVertical}_${date}.${ext}`;
}

// POST /generate — Generate all 3 formats and write to disk
router.post('/generate', authenticateToken, express.json(), async (req, res) => {
  try {
    let { runId } = req.body || {};
    const userId = req.user.sub;

    // If no runId provided, generate a new one (for immediate generation after run)
    if (!runId) {
      runId = crypto.randomUUID();
    }

    const rawRun = reportStore.getRun(userId, runId);
    if (!rawRun) {
      return res.status(404).json({ error: 'run not found' });
    }
    const run = await withMcpChain(rawRun);
    // Formatters render a CIBA step-up callout; the CIBA approval lives in
    // tokenChainService, not the run record, so bridge it here (see hasCibaStepUp).
    run.hasCibaStepUp = await hasCibaStepUp(run, new Map());

    // Ensure reports directory exists
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const files = [];

    // Generate Markdown
    const mdContent = formatMarkdown(run);
    const mdFilename = formatFilename(run.vertical, 'md');
    const mdPath = path.join(REPORTS_DIR, mdFilename);
    fs.writeFileSync(mdPath, mdContent, 'utf8');
    files.push({
      format: 'md',
      filename: mdFilename,
      path: mdPath,
      size: Buffer.byteLength(mdContent, 'utf8'),
    });

    // Generate HTML
    const htmlContent = formatHtml(run);
    const htmlFilename = formatFilename(run.vertical, 'html');
    const htmlPath = path.join(REPORTS_DIR, htmlFilename);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    files.push({
      format: 'html',
      filename: htmlFilename,
      path: htmlPath,
      size: Buffer.byteLength(htmlContent, 'utf8'),
    });

    // Try to generate PDF
    try {
      const pdfBuffer = await formatPdf(run);
      if (pdfBuffer) {
        const pdfFilename = formatFilename(run.vertical, 'pdf');
        const pdfPath = path.join(REPORTS_DIR, pdfFilename);
        fs.writeFileSync(pdfPath, pdfBuffer);
        files.push({
          format: 'pdf',
          filename: pdfFilename,
          path: pdfPath,
          size: pdfBuffer.length,
        });
      }
    } catch (_) {
      // PDF generation failed; skip (user can print HTML to PDF instead)
    }

    // Update run record with file metadata
    reportStore.appendFile(userId, runId, {
      format: 'md',
      filename: files[0].filename,
      generatedAt: new Date().toISOString(),
    });

    res.json({
      runId,
      files: files.map(f => ({
        format: f.format,
        filename: f.filename,
        size: f.size,
        downloadUrl: `/api/reports/${runId}/download?format=${f.format}`,
      })),
    });
  } catch (error) {
    console.error('[reportsRouter] /generate failed:', error.message);
    res.status(500).json({ error: 'report generation failed' });
  }
});

// GET /history — Past reports list (all reports, any user)
// Reports are a shared demo artifact list: the page must show every past
// report regardless of which demo identity generated it, so the list survives
// reseeds / different logins / vertical switching instead of "disappearing".
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { since, until, limit } = req.query;
    const runs = reportStore.listAllRuns({
      since,
      until,
      limit: limit ? parseInt(limit, 10) : 500,
    });
    // Annotate in place — listAllRuns returns fresh deserialized objects. The
    // cache makes the per-user getTokenChain lookup run once per distinct user.
    const cibaCache = new Map();
    for (const run of runs) run.hasCibaStepUp = await hasCibaStepUp(run, cibaCache);

    res.json({ runs });
  } catch (error) {
    console.error('[reportsRouter] /history failed:', error.message);
    res.status(500).json({ error: 'history query failed' });
  }
});

// GET /history/all — All runs (admin only)
router.get('/history/all', authenticateToken, requireScopes(['admin']), (req, res) => {
  try {
    const { since, until, vertical, limit } = req.query;
    const runs = reportStore.listAllRuns({
      since,
      until,
      vertical,
      limit: limit ? parseInt(limit, 10) : 500,
    });

    res.json({ runs });
  } catch (error) {
    console.error('[reportsRouter] /history/all failed:', error.message);
    res.status(500).json({ error: 'history query failed' });
  }
});

// GET /:runId/download — Download report file (generates on the fly if not pre-built)
router.get('/:runId/download', authenticateToken, async (req, res) => {
  try {
    const { runId } = req.params;
    const { format } = req.query;

    if (!['md', 'html', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'format must be md, html, or pdf' });
    }

    // Resolve across users — any report in the shared list is downloadable.
    const rawRun = reportStore.findRun(runId);
    if (!rawRun) {
      return res.status(404).json({ error: 'run not found' });
    }
    const userId = rawRun.userId;
    const run = await withMcpChain(rawRun);
    // Same CIBA bridge as /generate so on-the-fly downloads render the callout.
    run.hasCibaStepUp = await hasCibaStepUp(run, new Map());

    const contentType =
      format === 'md' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/pdf';
    // HTML and PDF render in the browser (opened in a tab); Markdown is delivered as a file.
    const disposition = format === 'md' ? 'attachment' : 'inline';

    // Check for a pre-generated file first
    const fileEntry = (run.files || []).find(f => f.filename.endsWith(`.${format}`));
    const filePath = fileEntry ? path.join(REPORTS_DIR, fileEntry.filename) : null;

    if (filePath && fs.existsSync(filePath)) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${fileEntry.filename}"`);
      return res.send(fs.readFileSync(filePath));
    }

    // Generate on the fly so the download buttons always work
    const filename = formatFilename(run.vertical || 'report', format);
    let content;
    if (format === 'md') {
      content = formatMarkdown(run);
    } else if (format === 'html') {
      content = formatHtml(run);
    } else {
      content = await formatPdf(run);
      if (!content) {
        return res.status(500).json({ error: 'PDF generation failed' });
      }
    }

    // Best-effort cache so repeat requests reuse the file. A write failure
    // (read-only / permission-denied reports dir in some deployments) must NOT
    // break the download — the content is already generated, so send it anyway.
    try {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(REPORTS_DIR, filename), content);
      reportStore.appendFile(userId, runId, {
        format,
        filename,
        generatedAt: new Date().toISOString(),
      });
    } catch (cacheErr) {
      console.warn('[reportsRouter] could not cache generated report (sending anyway):', cacheErr.message);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.send(content);
  } catch (error) {
    console.error('[reportsRouter] /download failed:', error.message);
    res.status(500).json({ error: 'download failed' });
  }
});

// GET /:runId/share — Generate shareable link
router.get('/:runId/share', authenticateToken, (req, res) => {
  try {
    const { runId } = req.params;

    // Resolve across users — any report in the shared list is shareable.
    const run = reportStore.findRun(runId);
    if (!run) {
      return res.status(404).json({ error: 'run not found' });
    }

    const shareToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SHARE_TOKEN_TTL_MS;

    const shareEntry = { runId, userId: run.userId, expiresAt };
    shareTokens.set(shareToken, shareEntry);
    reportShareStore.put(shareToken, shareEntry);

    const baseUrl = process.env.PUBLIC_APP_URL || 'https://demo-api-server:3001';
    const shareUrl = `${baseUrl}/api/reports/shared/${shareToken}`;

    res.json({
      shareToken,
      expiresAt: new Date(expiresAt).toISOString(),
      shareUrl,
    });
  } catch (error) {
    console.error('[reportsRouter] /share failed:', error.message);
    res.status(500).json({ error: 'share link generation failed' });
  }
});

// GET /shared/:token — Download via share token (unauthenticated)
router.get('/shared/:token', (req, res) => {
  try {
    const { token } = req.params;
    // Cache miss falls back to LMDB (lazy hydrate) so links survive a restart.
    let tokenEntry = shareTokens.get(token);
    if (!tokenEntry) {
      tokenEntry = reportShareStore.get(token); // returns null if expired
      if (tokenEntry) shareTokens.set(token, tokenEntry);
    }

    if (!tokenEntry || Date.now() >= tokenEntry.expiresAt) {
      return res.status(401).json({ error: 'share token expired or invalid' });
    }

    const run = reportStore.getRun(tokenEntry.userId, tokenEntry.runId);
    if (!run) {
      return res.status(404).json({ error: 'run not found' });
    }

    // Return the primary (MD) file by default
    const fileEntry = (run.files || [])[0];
    if (!fileEntry) {
      return res.status(404).json({ error: 'no files available' });
    }

    const filePath = path.join(REPORTS_DIR, fileEntry.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file not found on disk' });
    }

    const ext = path.extname(fileEntry.filename).toLowerCase().slice(1);
    const contentType =
      ext === 'md' ? 'text/markdown' : ext === 'html' ? 'text/html' : 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileEntry.filename}"`);
    res.send(fs.readFileSync(filePath));
  } catch (error) {
    console.error('[reportsRouter] /shared/:token failed:', error.message);
    res.status(500).json({ error: 'shared download failed' });
  }
});

// POST /bulk — Bulk export all runs (admin only)
router.post('/bulk', authenticateToken, requireScopes(['admin']), express.json(), async (req, res) => {
  try {
    const { since, until, vertical, format } = req.body || {};

    if (!['md', 'html'].includes(format)) {
      return res.status(400).json({ error: 'format must be md or html' });
    }

    const runs = reportStore.listAllRuns({ since, until, vertical, limit: 10000 });

    if (runs.length === 0) {
      return res.status(204).send();
    }

    let content = '';

    if (format === 'md') {
      content = `# Bulk Report Export\n\n`;
      content += `**Generated:** ${new Date().toISOString()}\n`;
      content += `**Runs:** ${runs.length}\n`;
      if (vertical) content += `**Vertical:** ${vertical}\n`;
      content += `\n---\n\n`;

      for (const run of runs) {
        content += `## Run ${run.runId}\n\n`;
        content += `- **User:** ${run.userId}\n`;
        content += `- **Vertical:** ${run.vertical}\n`;
        content += `- **Date:** ${run.startedAt}\n`;
        content += `- **Prompt:** ${run.prompt.substring(0, 200)}\n`;
        content += `- **Tools:** ${(run.toolsCalled || []).join(', ')}\n\n`;
      }
    } else if (format === 'html') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bulk Report</title>
<style>body{font-family:sans-serif;margin:2rem;line-height:1.6}h1{color:#277ba5}
.run{margin:2rem 0;padding:1rem;background:#f5f5f5;border-radius:4px}
.run h3{color:#277ba5;margin-top:0}</style></head><body>`;
      content += `<h1>Bulk Report Export</h1>`;
      content += `<p><strong>Generated:</strong> ${new Date().toISOString()}</p>`;
      content += `<p><strong>Runs:</strong> ${runs.length}</p>`;
      if (vertical) content += `<p><strong>Vertical:</strong> ${vertical}</p>`;

      for (const run of runs) {
        content += `<div class="run"><h3>Run ${run.runId}</h3>`;
        content += `<ul><li><strong>User:</strong> ${run.userId}</li>`;
        content += `<li><strong>Vertical:</strong> ${run.vertical}</li>`;
        content += `<li><strong>Date:</strong> ${run.startedAt}</li>`;
        content += `<li><strong>Prompt:</strong> ${run.prompt.substring(0, 200)}</li>`;
        content += `<li><strong>Tools:</strong> ${(run.toolsCalled || []).join(', ')}</li></ul></div>`;
      }

      content += `</body></html>`;
    }

    // Write file
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const bulkFilename = `bulk_${new Date().toISOString().replace(/T.*/, '').replace(/-/g, '')}.${format}`;
    const bulkPath = path.join(REPORTS_DIR, bulkFilename);
    fs.writeFileSync(bulkPath, content, 'utf8');

    res.setHeader('Content-Type', format === 'md' ? 'text/markdown' : 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${bulkFilename}"`);
    res.send(content);
  } catch (error) {
    console.error('[reportsRouter] /bulk failed:', error.message);
    res.status(500).json({ error: 'bulk export failed' });
  }
});

module.exports = router;
