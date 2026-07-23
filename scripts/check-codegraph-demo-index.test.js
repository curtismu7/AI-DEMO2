#!/usr/bin/env node
/**
 * Negative tests for check-codegraph-demo-index.js.
 * Run: node --test scripts/check-codegraph-demo-index.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'scripts', 'check-codegraph-demo-index.js');

function runCheck(root) {
  return spawnSync(process.execPath, [CHECK], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CODEGRAPH_CHECK_ROOT: root },
  });
}

describe('check-codegraph-demo-index', () => {
  it('passes on the real repo', () => {
    const r = runCheck(ROOT);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /demo-codegraph\.db/);
  });

  it('fails when CODEGRAPH_DB_PATH points at product codegraph.db', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hygiene-'));
    try {
      // Minimal tree: copy only the files the checker reads.
      for (const rel of [
        'docker-compose.yml',
        'scripts/build-codegraph.py',
        'langchain_agent/src/codegraph/index_guard.py',
        'langchain_agent/src/codegraph/db.py',
        'langchain_agent/tests/test_codegraph_index_guard.py',
      ]) {
        const src = path.join(ROOT, rel);
        const dest = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      const compose = path.join(dir, 'docker-compose.yml');
      let txt = fs.readFileSync(compose, 'utf8');
      txt = txt.replaceAll('demo-codegraph.db', 'codegraph.db');
      fs.writeFileSync(compose, txt);
      const r = runCheck(dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /codegraph\.db/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
