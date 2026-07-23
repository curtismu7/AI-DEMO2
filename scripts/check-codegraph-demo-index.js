#!/usr/bin/env node
/**
 * check-codegraph-demo-index.js — guardrail for Code Explorer demo index wiring.
 *
 * Regression (2026-07-22 / #772): Refresh wrote `.codegraph/codegraph.db` (host
 * CodeGraph product path) and/or nested paths as `live-repo/...` when the baked
 * indexer rooted at `/app`. Demo index must stay on demo-codegraph.db with a
 * builder marker, UI+API default scope, and a live-mounted indexer.
 *
 * Bake paths (#775): setup:fresh / run.sh / se-update-code.sh must copy from
 * demo-codegraph.db into langchain_agent/codegraph.db (image bake input).
 *
 *   node scripts/check-codegraph-demo-index.js
 *   npm run hygiene:check
 */

const fs = require('node:fs');
const path = require('node:path');

// CODEGRAPH_CHECK_ROOT lets negative tests point at a fixture tree; default is
// the repo root next to this script (so `node scripts/...` works from anywhere).
const ROOT = process.env.CODEGRAPH_CHECK_ROOT
  ? path.resolve(process.env.CODEGRAPH_CHECK_ROOT)
  : path.join(__dirname, '..');
const fails = [];
const fail = (msg) => fails.push(msg);

const BUILDER = 'demo-build-codegraph';
const DEMO_DB = 'demo-codegraph.db';
/** Bake scripts must copy FROM this path into langchain_agent/codegraph.db. */
const BAKE_SRC = `.codegraph/${DEMO_DB}`;

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`${rel}: missing`);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

/** Fail if bake script still copies from the host product DB name. */
function requireDemoBakeSource(rel, text) {
  if (!text) return;
  if (!text.includes(BAKE_SRC) && !text.includes(`'${DEMO_DB}'`) && !text.includes(`"${DEMO_DB}"`)) {
    fail(`${rel}: must bake from ${BAKE_SRC}`);
  }
  // Reject the pre-#775 pattern: cp/join from .codegraph/codegraph.db
  if (
    text.includes('.codegraph/codegraph.db') ||
    /['"]\.codegraph['"]\s*,\s*['"]codegraph\.db['"]/.test(text) ||
    /\.codegraph['"]\s*,\s*['"]codegraph\.db['"]/.test(text)
  ) {
    fail(
      `${rel}: must not read .codegraph/codegraph.db for bake ` +
        `(host CodeGraph product owns that file; use ${BAKE_SRC})`,
    );
  }
}

// Compose: demo DB path + live indexer; never CODEGRAPH_INDEX_ALL.
const compose = read('docker-compose.yml');
if (compose) {
  if (!compose.includes(`CODEGRAPH_DB_PATH: "/app/live-repo/.codegraph/${DEMO_DB}"`)) {
    fail(
      `docker-compose.yml: langchain-agent CODEGRAPH_DB_PATH must be ` +
        `/app/live-repo/.codegraph/${DEMO_DB} (not codegraph.db)`,
    );
  }
  if (/CODEGRAPH_DB_PATH:\s*["'].*\/codegraph\.db["']/.test(compose)) {
    fail(
      'docker-compose.yml: CODEGRAPH_DB_PATH must not point at codegraph.db ' +
        '(host CodeGraph product owns that file)',
    );
  }
  if (!compose.includes('CODEGRAPH_INDEXER: "/app/live-repo/scripts/build-codegraph.py"')) {
    fail(
      'docker-compose.yml: CODEGRAPH_INDEXER must be the live-mounted ' +
        '/app/live-repo/scripts/build-codegraph.py',
    );
  }
  if (/^\s*CODEGRAPH_INDEX_ALL\s*:/m.test(compose)) {
    fail(
      'docker-compose.yml: do not set CODEGRAPH_INDEX_ALL — Refresh must stay UI+API scoped',
    );
  }
}

// Indexer + guard share the builder id and demo DB name.
const indexer = read('scripts/build-codegraph.py');
if (indexer) {
  if (!indexer.includes(`BUILDER_ID = '${BUILDER}'`) && !indexer.includes(`BUILDER_ID = "${BUILDER}"`)) {
    fail(`scripts/build-codegraph.py: missing BUILDER_ID = '${BUILDER}'`);
  }
  if (!indexer.includes(`'${DEMO_DB}'`) && !indexer.includes(`"${DEMO_DB}"`)) {
    fail(`scripts/build-codegraph.py: must target ${DEMO_DB}`);
  }
  if (!indexer.includes("DEFAULT_INCLUDE_DIRS = ('demo_api_ui', 'demo_api_server')") &&
      !indexer.includes('DEFAULT_INCLUDE_DIRS = ("demo_api_ui", "demo_api_server")')) {
    fail(
      'scripts/build-codegraph.py: DEFAULT_INCLUDE_DIRS must be demo_api_ui + demo_api_server',
    );
  }
  if (!indexer.includes("'live-repo'") && !indexer.includes('"live-repo"')) {
    fail("scripts/build-codegraph.py: SKIP_DIRS must include 'live-repo'");
  }
}

const guard = read('langchain_agent/src/codegraph/index_guard.py');
if (guard) {
  if (!guard.includes(`BUILDER_ID = "${BUILDER}"`) && !guard.includes(`BUILDER_ID = '${BUILDER}'`)) {
    fail(`langchain_agent/src/codegraph/index_guard.py: missing BUILDER_ID = "${BUILDER}"`);
  }
  if (!guard.includes(`DEMO_DB_NAME = "${DEMO_DB}"`) && !guard.includes(`DEMO_DB_NAME = '${DEMO_DB}'`)) {
    fail(`langchain_agent/src/codegraph/index_guard.py: missing DEMO_DB_NAME = "${DEMO_DB}"`);
  }
  if (!guard.includes('PRODUCT_DB_NAME = "codegraph.db"') && !guard.includes("PRODUCT_DB_NAME = 'codegraph.db'")) {
    fail('langchain_agent/src/codegraph/index_guard.py: must refuse PRODUCT_DB_NAME = codegraph.db');
  }
  if (!guard.includes('"live-repo/"') && !guard.includes("'live-repo/'")) {
    fail('langchain_agent/src/codegraph/index_guard.py: must forbid live-repo/ path prefix');
  }
}

const dbPy = read('langchain_agent/src/codegraph/db.py');
if (dbPy) {
  if (!dbPy.includes(DEMO_DB)) {
    fail(`langchain_agent/src/codegraph/db.py: default CODEGRAPH_DB_PATH must use ${DEMO_DB}`);
  }
  // #775 — NL filler must not flood FTS OR-queries.
  if (!dbPy.includes('_FTS_STOPWORDS')) {
    fail('langchain_agent/src/codegraph/db.py: missing _FTS_STOPWORDS (NL FTS hardening)');
  }
}

const retrieve = read('langchain_agent/src/codegraph/retrieve.py');
if (retrieve) {
  if (!retrieve.includes('_hit_relevance') || !retrieve.includes('_extra_terms')) {
    fail(
      'langchain_agent/src/codegraph/retrieve.py: missing _hit_relevance / _extra_terms ' +
        '(identifier blend + ranking)',
    );
  }
}

// Bake scripts: copy demo DB → langchain_agent/codegraph.db for image bake.
requireDemoBakeSource('run.sh', read('run.sh'));
requireDemoBakeSource('se-update-code.sh', read('se-update-code.sh'));
requireDemoBakeSource(
  'demo_api_server/scripts/setupFresh.js',
  read('demo_api_server/scripts/setupFresh.js'),
);

const tests = read('langchain_agent/tests/test_codegraph_index_guard.py');
if (!tests) {
  fail('langchain_agent/tests/test_codegraph_index_guard.py: missing smoke/guard tests');
}

const retrieveTests = read('langchain_agent/tests/test_retrieve.py');
if (retrieveTests && !retrieveTests.includes('test_sanitize_fts_drops_stopwords')) {
  fail(
    'langchain_agent/tests/test_retrieve.py: missing test_sanitize_fts_drops_stopwords',
  );
}

if (fails.length) {
  console.error('✗ Code Explorer demo-index hygiene FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error('\nSee REGRESSION_PLAN.md — Code Explorer index DB (#772 / #775).');
  process.exit(1);
}
console.log(
  `✓ Code Explorer demo-index: ${DEMO_DB} + builder=${BUILDER} + UI/API scope + ` +
    'live indexer + bake paths + FTS/retrieve harden',
);
