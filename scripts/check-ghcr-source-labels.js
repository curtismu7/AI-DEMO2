#!/usr/bin/env node
// scripts/check-ghcr-source-labels.js
'use strict';

/**
 * Static hygiene: every CI-built service's Dockerfile carries
 * `LABEL org.opencontainers.image.source` in its FINAL stage.
 *
 * Why this gate exists. Pushing to a GHCR package needs TWO independent things,
 * and either one missing produces the IDENTICAL error —
 * "denied: permission_denied: write_package":
 *
 *   1. This label. It links the package to the repo on push. In-repo, so a PR
 *      can fix it — which is what this gate enforces.
 *   2. The package's "Manage Actions access" list containing this repo with the
 *      Write role. UI-only, unreadable and unsettable through any API, and it
 *      starts EMPTY on every newly created package.
 *
 * Because they fail identically, having (1) and not (2) looks exactly like
 * having neither, which is what made this expensive to diagnose the first time
 * (#2545/#2546) and again later (#2551 relinked 10 packages, #2578 another 3).
 * A PAT was tried and reverted twice (#2540, #2548) while the real cause was
 * being found — see .github/workflows/build-images.yml for the full history.
 *
 * This gate can only enforce half the contract. That is the point: it makes the
 * half that IS code impossible to forget, so a first push that fails is always
 * the UI grant and never the label, which turns an ambiguous error into an
 * unambiguous one.
 *
 * A new service's FIRST push still fails until someone grants Actions access.
 * That is unavoidable — the package does not exist to be granted until the
 * first push attempt creates it.
 *
 * Reads Dockerfiles as TEXT and shells to se-update-code.sh --print-map, the
 * same source build-images.yml uses to build its matrix, so this cannot drift
 * from what CI actually pushes. No dependencies: root node_modules is not
 * installed in CI's hygiene job (same constraint as
 * check-service-map-complete.js).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL_KEY = 'org.opencontainers.image.source';
const EXPECTED_URL = 'https://github.com/curtismu7/AI-DEMO2';

/**
 * True when the label appears in the Dockerfile's LAST stage.
 *
 * A LABEL applies only to the stage it is written in, so a label above an
 * intermediate `FROM` is silently dropped from the pushed image and the push is
 * refused exactly as if it were absent. Checking "contains the label" is not
 * enough; it has to survive to the final stage.
 *
 * @param {string} text Dockerfile contents
 * @returns {{ present: boolean, inFinalStage: boolean, url: string|null }}
 */
function inspectDockerfile(text) {
  const lines = text.split('\n');
  let lastFrom = -1;
  let labelLine = -1;
  let url = null;

  lines.forEach((line, i) => {
    const bare = line.trim();
    if (/^FROM\s/i.test(bare)) lastFrom = i;
    if (bare.startsWith('#')) return; // a commented-out label is not a label
    if (bare.includes(LABEL_KEY)) {
      labelLine = i;
      const m = bare.match(new RegExp(`${LABEL_KEY}\\s*=\\s*["']?([^\\s"']+)`));
      if (m) url = m[1];
    }
  });

  return {
    present: labelLine !== -1,
    inFinalStage: labelLine !== -1 && labelLine > lastFrom,
    url,
  };
}

/**
 * @param {object[]} map entries from `se-update-code.sh --print-map`
 * @returns {string[]} one message per problem; empty means pass
 */
function checkLabels(map) {
  const errors = [];
  for (const entry of map) {
    if (!entry.sourceDir || !entry.ghcrImage) continue; // check-service-map-complete owns that
    const rel = path.join(entry.sourceDir, 'Dockerfile');
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`${entry.key}: no Dockerfile at ${rel} — CI builds ${entry.ghcrImage} from this dir`);
      continue;
    }
    const { present, inFinalStage, url } = inspectDockerfile(fs.readFileSync(abs, 'utf8'));
    if (!present) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): ${rel} is missing `
        + `LABEL ${LABEL_KEY}=${EXPECTED_URL} — GHCR will refuse the push with `
        + '"denied: permission_denied: write_package"',
      );
    } else if (!inFinalStage) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): ${rel} has the label but NOT in the final stage — `
        + 'a LABEL applies only to its own stage, so it is dropped from the pushed image '
        + 'and the push fails exactly as if the label were absent',
      );
    } else if (url && url !== EXPECTED_URL) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): ${rel} labels source as "${url}", expected `
        + `"${EXPECTED_URL}" — the package links to the wrong repo`,
      );
    }
  }
  return errors;
}

function main() {
  let map;
  try {
    const raw = execFileSync(path.join(ROOT, 'se-update-code.sh'), ['--print-map'], {
      encoding: 'utf8', cwd: ROOT,
    });
    map = JSON.parse(raw);
  } catch (e) {
    console.error(`[ghcr-labels] FAIL — could not read the build map: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(map) || map.length === 0) {
    console.error('[ghcr-labels] FAIL — --print-map returned no services; parser or ALL_KEYS is broken');
    process.exit(1);
  }

  const errors = checkLabels(map);
  if (errors.length) {
    console.error('[ghcr-labels] FAILED:');
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      '\n  Add to the FINAL stage of each Dockerfile above:\n'
      + `    LABEL ${LABEL_KEY}=${EXPECTED_URL}\n`
      + '\n  NOTE: the label is only half. Each package also needs its repo added\n'
      + '  with the Write role under "Manage Actions access" on the package settings\n'
      + '  page. That half is UI-only and starts empty, so a brand-new service still\n'
      + '  fails its first push until someone grants it.',
    );
    process.exit(1);
  }
  console.log(`[ghcr-labels] OK — ${map.length} CI-built services carry the source label in their final stage`);
}

if (require.main === module) main();

module.exports = { inspectDockerfile, checkLabels, LABEL_KEY, EXPECTED_URL };
