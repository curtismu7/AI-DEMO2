#!/usr/bin/env node
'use strict';

/**
 * Drift gate for the Protocol Playground's generated data.
 *
 * `demo_api_ui/src/data/protocolFlows.json` is committed but generated from JSDoc
 * annotations in `demo_api_server/routes/` by `generateProtocolFlows.js`. Every
 * other generated artifact here has a `*:check` counterpart; this one did not, so
 * a parser change could reach the committed file — or fail to — with nothing in
 * CI to notice. That is how the `Body: {...}` prose leak shipped: the parser and
 * the artifact disagreed and no gate existed to say so.
 *
 * Regenerates in memory (no writes) and compares against the committed file.
 * Exits 1 on drift, printing the fix command.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '../..');
const ARTIFACT = path.join(REPO_ROOT, 'demo_api_ui/src/data/protocolFlows.json');
const GENERATOR = path.join(__dirname, 'generateProtocolFlows.js');

function main() {
  if (!fs.existsSync(ARTIFACT)) {
    console.error(`❌ protocolFlows.json is missing at ${ARTIFACT}`);
    console.error('   Run: npm --prefix demo_api_server run protocols:gen');
    process.exit(1);
  }

  const committed = fs.readFileSync(ARTIFACT, 'utf8');

  // The generator writes to a fixed path, so redirect it at a scratch copy:
  // restore the original afterwards no matter what happens.
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-check-'));
  const backup = path.join(backupDir, 'protocolFlows.json');
  fs.writeFileSync(backup, committed);

  let regenerated;
  const realLog = console.log;
  try {
    // The generator announces "Generated N protocol flows" — misleading inside a
    // check, which restores the file and writes nothing that survives.
    console.log = () => {};
    require(GENERATOR).main();
    regenerated = fs.readFileSync(ARTIFACT, 'utf8');
  } finally {
    console.log = realLog;
    // Always put the committed content back — the check must not mutate the tree.
    fs.writeFileSync(ARTIFACT, committed);
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  if (regenerated === committed) {
    console.log('[OK] protocolFlows.json matches a fresh render of the route annotations.');
    return;
  }

  console.error('❌ protocolFlows.json drifts from the JSDoc annotations it is generated from.');
  console.error('   The committed file and a fresh render disagree, so the Playground is');
  console.error('   serving stale or hand-edited data.');
  console.error('');
  console.error('   Fix: npm --prefix demo_api_server run protocols:gen   (then commit the result)');
  console.error('');

  // Show the first differing line so the failure is actionable in CI logs.
  const a = committed.split('\n');
  const b = regenerated.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      console.error(`   first difference at line ${i + 1}:`);
      console.error(`     committed:   ${String(a[i]).trim().slice(0, 160)}`);
      console.error(`     regenerated: ${String(b[i]).trim().slice(0, 160)}`);
      break;
    }
  }
  process.exit(1);
}

main();
