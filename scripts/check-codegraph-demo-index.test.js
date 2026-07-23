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

/** Files the checker reads — keep in sync with check-codegraph-demo-index.js. */
const CHECKED_RELS = [
  'docker-compose.yml',
  'scripts/build-codegraph.py',
  'langchain_agent/src/codegraph/index_guard.py',
  'langchain_agent/src/codegraph/db.py',
  'langchain_agent/src/codegraph/retrieve.py',
  'langchain_agent/tests/test_codegraph_index_guard.py',
  'langchain_agent/tests/test_retrieve.py',
  'run.sh',
  'se-update-code.sh',
  'demo_api_server/scripts/setupFresh.js',
];

function runCheck(root) {
  return spawnSync(process.execPath, [CHECK], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CODEGRAPH_CHECK_ROOT: root },
  });
}

/** Copy the checker's input tree into a temp dir for mutation tests. */
function fixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hygiene-'));
  for (const rel of CHECKED_RELS) {
    const src = path.join(ROOT, rel);
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return dir;
}

describe('check-codegraph-demo-index', () => {
  it('passes on the real repo', () => {
    const r = runCheck(ROOT);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /demo-codegraph\.db/);
    assert.match(r.stdout, /bake paths/);
  });

  it('fails when CODEGRAPH_DB_PATH points at product codegraph.db', () => {
    const dir = fixtureTree();
    try {
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

  it('fails when setup:fresh bakes from product .codegraph/codegraph.db', () => {
    const dir = fixtureTree();
    try {
      const setup = path.join(dir, 'demo_api_server/scripts/setupFresh.js');
      let txt = fs.readFileSync(setup, 'utf8');
      txt = txt.replaceAll('demo-codegraph.db', 'codegraph.db');
      fs.writeFileSync(setup, txt);
      const r = runCheck(dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /setupFresh|bake|codegraph\.db/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when run.sh bakes from product .codegraph/codegraph.db', () => {
    const dir = fixtureTree();
    try {
      const runSh = path.join(dir, 'run.sh');
      let txt = fs.readFileSync(runSh, 'utf8');
      txt = txt.replace(
        'cp -f "$BASEDIR/.codegraph/demo-codegraph.db"',
        'cp -f "$BASEDIR/.codegraph/codegraph.db"',
      );
      fs.writeFileSync(runSh, txt);
      const r = runCheck(dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /run\.sh|bake|codegraph\.db/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when FTS stopwords hardening is removed from db.py', () => {
    const dir = fixtureTree();
    try {
      const dbPy = path.join(dir, 'langchain_agent/src/codegraph/db.py');
      let txt = fs.readFileSync(dbPy, 'utf8');
      txt = txt.replaceAll('_FTS_STOPWORDS', '_REMOVED_STOPWORDS');
      fs.writeFileSync(dbPy, txt);
      const r = runCheck(dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /_FTS_STOPWORDS|FTS/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
