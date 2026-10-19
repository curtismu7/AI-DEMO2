#!/usr/bin/env node
'use strict';

// The ID-JAG playground's plain functions and data (code snippet builder, real-client setup text, Learn glossary and
// sources) are VENDORED from the standalone kit (github.com/cmuir_pingcorp/id-jag-standalone), which is their source of
// truth. This fails when a vendored file no longer matches the hash in its manifest, i.e. someone edited a copy here.
// Change it in the kit, then in the kit repo run `node scripts/sync-to-app.mjs --app=<this checkout>`.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST = 'demo_api_ui/src/data/idJagCore.manifest.json';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Returns the list of problems (empty = every vendored file matches its manifest entry). */
function check(root) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')); } catch { return [`${MANIFEST} is missing or not JSON`]; }
  const entries = Object.entries(manifest.files || {});
  if (!entries.length) return [`${MANIFEST} lists no files`];
  const problems = [];
  for (const [file, hash] of entries) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) problems.push(`${file}: listed in the manifest but missing`);
    else if (sha(full) !== hash) problems.push(`${file}: edited here; it is vendored from the kit (manifest commit ${String(manifest.commit).slice(0, 9)})`);
  }
  return problems;
}

if (require.main === module) {
  const problems = check(path.resolve(__dirname, '..'));
  if (problems.length) {
    console.error('[id-jag-core] vendored files out of sync:\n  ' + problems.join('\n  '));
    console.error('Change them in id-jag-standalone, then run `node scripts/sync-to-app.mjs --app=<this checkout>` there and commit the result here.');
    process.exit(1);
  }
  console.log('[id-jag-core] OK: vendored ID-JAG files match the kit manifest');
}

module.exports = { check, MANIFEST };
