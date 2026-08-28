#!/usr/bin/env node
// scripts/ci-build-matrix.js
'use strict';

/**
 * Join a merge's changed paths against the service map and emit a GitHub
 * Actions matrix of images to build.
 *
 * Pure with respect to its inputs — no network, no git, no Docker — because
 * the workflow that calls it cannot be tested until it is merged. Everything
 * that is not YAML is therefore tested here.
 *
 * Usage (in CI):
 *   ./se-update-code.sh --print-map > map.json
 *   node scripts/ci-build-matrix.js map.json changed.txt >> "$GITHUB_OUTPUT"
 */

const fs = require('fs');

/**
 * @param {object[]} map from `se-update-code.sh --print-map`
 * @param {string[]} changedPaths repo-relative paths changed by the merge
 * @returns {{include: {key:string, ghcrImage:string, composeService:string, localImage:string}[]}}
 */
function buildMatrix(map, changedPaths) {
  const include = [];
  for (const entry of map) {
    if (!entry.sourceDir) continue;
    // The trailing slash is the whole guard: without it "demo_api_server"
    // also claims "demo_api_server_extra/file.js".
    const prefix = `${entry.sourceDir}/`;
    const touched = changedPaths.some((p) => p.startsWith(prefix));
    if (!touched) continue;
    // No build-context field here: the build runs through docker compose,
    // which owns the real build context and dockerfile path — those vary per
    // service and are NOT derivable from sourceDir (the BFF builds from the
    // repo root, not from demo_api_server/).
    include.push({
      key: entry.key,
      ghcrImage: entry.ghcrImage,
      composeService: entry.composeService,
      localImage: entry.localImage,
    });
  }
  return { include };
}

function main(argv) {
  const [mapFile, changedFile] = argv;
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const changedPaths = fs.readFileSync(changedFile, 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const matrix = buildMatrix(map, changedPaths);
  console.log(`matrix=${JSON.stringify(matrix)}`);
  console.log(`any=${matrix.include.length > 0}`);
  console.error(
    matrix.include.length
      ? `[ci-build-matrix] building: ${matrix.include.map((e) => e.key).join(', ')}`
      : '[ci-build-matrix] no service source changed — building nothing',
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { buildMatrix, main };
