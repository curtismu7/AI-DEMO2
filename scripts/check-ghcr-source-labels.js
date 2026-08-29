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
 * installed in the CI job that runs this (same constraint as
 * check-service-map-complete.js).
 *
 * Runs from build-images.yml, on the merges that actually push images — not
 * from `npm run hygiene:check`, which fired it on every local hygiene pass for
 * no benefit.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL_KEY = 'org.opencontainers.image.source';
const EXPECTED_URL = 'https://github.com/curtismu7/AI-DEMO2';
// LABEL_KEY is interpolated into a RegExp; its dots are wildcards otherwise.
const ESCAPED_KEY = LABEL_KEY.replace(/\./g, '\\.');

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
      // Tolerate every form Docker accepts, not just the one this repo happens
      // to use: a quoted key, `=`-separated or the legacy space-separated form.
      // A value this cannot parse must stay null and FAIL below — silently
      // skipping the wrong-repo check is how a label pointing at another repo
      // would sail through.
      const m = bare.match(new RegExp(`${ESCAPED_KEY}["']?(?:\\s*=\\s*|\\s+)["']?([^\\s"']+)`));
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
    } else if (url !== EXPECTED_URL) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): ${rel} labels source as `
        + `${url === null ? '(unparseable)' : `"${url}"`}, expected `
        + `"${EXPECTED_URL}" — the package links to the wrong repo`,
      );
    }
  }
  return errors;
}

/**
 * Guard the assumption the gate above is built on.
 *
 * `checkLabels` derives the Dockerfile as `<sourceDir>/Dockerfile`, but CI does
 * not build that path - it builds through docker compose, which owns
 * `context:`, `dockerfile:` and `target:`. ci-build-matrix.js says so outright:
 * those "are NOT derivable from sourceDir". Today every service happens to
 * agree, which is exactly what makes the drift dangerous - the day one adopts
 * `dockerfile: Dockerfile.tier-manager` or a build `target:`, the gate would
 * read a different file than CI pushes, print OK, and hand back the ambiguous
 * "write_package" error it exists to eliminate.
 *
 * So rather than reimplement compose resolution, assert the assumption and fail
 * loudly the moment it stops holding.
 *
 * Text-parsed, not YAML-parsed: root node_modules is not installed in CI's
 * hygiene job, the same constraint the rest of this file works under.
 *
 * @param {object[]} map entries from `se-update-code.sh --print-map`
 * @param {string} composeText contents of docker-compose.yml
 * @returns {string[]} one message per problem; empty means pass
 */
function checkComposeAgreement(map, composeText) {
  const errors = [];
  const lines = composeText.split('\n');

  // service name -> its raw block, keyed off two-space indentation
  const blocks = new Map();
  let current = null;
  for (const line of lines) {
    const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (svc) {
      current = svc[1];
      blocks.set(current, []);
      continue;
    }
    if (/^\S/.test(line)) current = null; // left the services: mapping
    if (current) blocks.get(current).push(line);
  }

  const value = (raw) => raw.replace(/#.*$/, '').trim().replace(/^["']|["']$/g, '');

  for (const entry of map) {
    if (!entry.sourceDir || !entry.ghcrImage || !entry.composeService) continue;
    const block = blocks.get(entry.composeService);
    if (!block) {
      errors.push(
        `${entry.key}: docker-compose.yml has no service "${entry.composeService}" - `
        + 'the build map and compose disagree about what CI builds',
      );
      continue;
    }

    const buildIdx = block.findIndex((l) => /^ {4}build:/.test(l));
    if (buildIdx === -1) continue; // pulled image, nothing to build

    const inline = value(block[buildIdx].replace(/^ {4}build:/, ''));
    let context = inline || '.';
    let dockerfile = 'Dockerfile';
    let target = null;

    if (!inline) {
      for (let i = buildIdx + 1; i < block.length && /^ {6}\S/.test(block[i]); i += 1) {
        const kv = block[i].match(/^ {6}(context|dockerfile|target):(.*)$/);
        if (!kv) continue;
        if (kv[1] === 'context') context = value(kv[2]);
        if (kv[1] === 'dockerfile') dockerfile = value(kv[2]);
        if (kv[1] === 'target') target = value(kv[2]);
      }
    }

    if (target) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): docker-compose.yml builds ${entry.composeService} `
        + `with target: ${target}. This gate only inspects a Dockerfile's FINAL stage, so it `
        + 'cannot tell whether the label survives into that target. Teach it about targets '
        + 'before adding one.',
      );
    }

    const actual = path.posix.normalize(path.posix.join(context, dockerfile)).replace(/^\.\//, '');
    const assumed = path.posix.join(entry.sourceDir, 'Dockerfile');
    if (actual !== assumed) {
      errors.push(
        `${entry.key} (${entry.ghcrImage}): this gate checks ${assumed}, but docker-compose.yml `
        + `builds ${entry.composeService} from ${actual}. CI pushes what compose builds, so the `
        + 'gate is inspecting the wrong file and would pass while the push fails.',
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

  const composeText = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const errors = [...checkComposeAgreement(map, composeText), ...checkLabels(map)];
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

module.exports = { inspectDockerfile, checkLabels, checkComposeAgreement, LABEL_KEY, EXPECTED_URL };
