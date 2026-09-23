'use strict';

/**
 * /api/admin/promptfoo — run promptfoo eval suites against the live stack.
 *
 * Allow-list of config keys only (same pattern as routes/pingcli.js): the
 * request names a suite, never a free-form command, so there is no injection
 * surface. promptfoo itself is invoked via npx with a pinned version.
 */

const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const PROMPTFOO_VERSION = '0.123.1';
const CONFIG_DIR = path.join(__dirname, '..', 'promptfoo');

// Each suite: config file + human label. Only these keys are runnable.
const SUITES = {
  'agent-eval': {
    label: 'Agent correctness',
    description: 'Use-case triggers × heuristics/LLM providers with assertions on real values',
    config: 'agent-eval.yaml',
  },
  'redteam-eval': {
    label: 'Red-team probes',
    description: 'Prompt injection, credential exfiltration, authorization bypass probes',
    config: 'redteam-eval.yaml',
  },
};

const JSON_OUT = path.join(CONFIG_DIR, 'output');
fs.mkdirSync(JSON_OUT, { recursive: true });

function findNpx() {
  const candidates = ['/opt/homebrew/bin/npx', '/usr/local/bin/npx', 'npx'];
  for (const c of candidates) {
    if (c === 'npx' || fs.existsSync(c)) return c;
  }
  throw new Error('npx not found');
}

/** GET /suites — list runnable suites. */
router.get('/suites', (req, res) => {
  res.json({
    suites: Object.entries(SUITES).map(([key, s]) => ({
      key,
      label: s.label,
      config: `promptfoo/${s.config}`,
      description: s.description,
    })),
  });
});

/** GET /results/:suite — latest saved eval result for a suite. */
router.get('/results/:suite', (req, res) => {
  const suite = SUITES[req.params.suite];
  if (!suite) return res.status(404).json({ error: 'unknown suite' });
  const file = path.join(JSON_OUT, `${req.params.suite}-latest.json`);
  if (!fs.existsSync(file)) {
    return res.json({ exists: false });
  }
  res.json({ exists: true, result: JSON.parse(fs.readFileSync(file, 'utf8')) });
});

/**
 * POST /run { suite }
 * Runs `npx promptfoo@<version> eval -c <config> -o <json> --no-cache`,
 * then reads the output JSON and returns a compact summary.
 */
router.post('/run', async (req, res) => {
  const suite = SUITES[req.body?.suite];
  if (!suite) {
    return res.status(400).json({ error: 'unknown_suite', message: 'Pass a known suite key.' });
  }

  const configPath = path.join(CONFIG_DIR, suite.config);
  const outFile = path.join(JSON_OUT, `${req.body.suite}-latest.json`);
  const args = [
    '--yes',
    `promptfoo@${PROMPTFOO_VERSION}`,
    'eval',
    '-c', configPath,
    '-o', outFile,
    '--no-cache',
  ];

  execFile('npx', args, { timeout: 5 * 60 * 1000, cwd: path.join(__dirname, '..'), maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
    let result = null;
    if (fs.existsSync(outFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const results = parsed.results?.results || [];
        result = {
          evalId: parsed.evalId || null,
          description: parsed.description || suite.label,
          stats: parsed.results?.stats || null,
          passCount: results.filter((r) => r.success).length,
          failCount: results.filter((r) => !r.success).length,
          cases: results.map((r) => ({
            description: r.description || rtestCaseLabel(r),
            promptSnippet: String(r.prompt?.raw || r.prompt || '').slice(0, 200),
            outputSnippet: String(r.response?.output || r.output || '').slice(0, 500),
            success: !!r.success,
            score: r.score ?? null,
            error: r.error ? String(r.error).slice(0, 500) : null,
          })),
        };
      } catch (parseErr) {
        result = null;
        req.log?.warn?.({ err: parseErr.message }, 'promptfoo result parse failed');
      }
    }
    // Return even on non-zero exit — the UI shows the error output.
    res.json({
      suite: req.body.suite,
      exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      error: err ? String(err.message).slice(0, 500) : null,
      stderr: err ? stderrTail(stderr) : null,
      result,
    });
  });
});

function rtestCaseLabel(testCase) {
  return testCase?.vars ? JSON.stringify(testCase.vars).slice(0, 120) : '(case)';
}

function stderrTail(stderr) {
  return stderr ? String(stderr).slice(-2000) : '';
}

module.exports = router;
