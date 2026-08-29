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
 * Selection is by sourceDir prefix PLUS derived root-file dependencies. The
 * prefix match alone missed a whole class: six services build from `context: .`
 * and COPY root-level inputs that belong to no service's sourceDir
 * (scope-topology.json, llm-timeouts.json, docs/, mcp-tool-schemas.json,
 * snapshots/*, graphify-out/*.kb.json). A merge touching only one of those
 * matched no prefix, produced an empty matrix, and logged "no service source
 * changed — building nothing", which reads as correct and is not.
 *
 * TECH_DEBT rejected fixing this as "a fifteenth copy of the service map".
 * That objection only applies to a HAND-MAINTAINED table — these dependencies
 * are DERIVED by reading the Dockerfiles that declare them, so there is nothing
 * to keep in sync. The Dockerfile is already the source of truth for what the
 * image contains; this just reads it.
 *
 * Usage (in CI):
 *   ./se-update-code.sh --print-map > map.json
 *   node scripts/ci-build-matrix.js map.json changed.txt >> "$GITHUB_OUTPUT"
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Compose service -> build context, for services that declare one.
 *
 * Needed because COPY sources resolve against the BUILD CONTEXT, not the repo
 * root. `COPY scripts/health-check.js` means `oauth-mcp/scripts/...` for a
 * service built with `context: ./oauth-mcp`, and the repo-root `scripts/` for
 * one built with `context: .`. Only the latter can depend on a root file, so
 * getting this wrong would attribute root changes to services that never see
 * them.
 *
 * ponytail: this is the third near-identical compose service-block reader
 * (see check-ghcr-source-labels.js and compose-env-diff.js). Logged in
 * TECH_DEBT — consolidate into scripts/lib/composeBlocks.js once all three
 * have landed; doing it across three in-flight branches would just conflict.
 *
 * @param {string} composeText contents of docker-compose.yml
 * @returns {Map<string,string>} service name -> context
 */
function buildContexts(composeText) {
  const contexts = new Map();
  let current = null;
  let inServices = false;
  let inBuild = false;
  for (const line of composeText.split('\n')) {
    const topLevel = line.match(/^([A-Za-z0-9_.-]+):/);
    if (topLevel) {
      inServices = topLevel[1] === 'services';
      current = null;
      inBuild = false;
      continue;
    }
    if (!inServices) continue;
    const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (svc) {
      current = svc[1];
      inBuild = false;
      continue;
    }
    if (!current) continue;
    if (/^ {4}\S/.test(line)) inBuild = /^ {4}build:/.test(line);
    if (!inBuild) continue;
    const ctx = line.match(/^ {6}context:(.*)$/);
    if (ctx) contexts.set(current, ctx[1].replace(/#.*$/, '').trim().replace(/^["']|["']$/g, ''));
  }
  return contexts;
}

/**
 * The COPY sources of a Dockerfile, as build-context-relative paths.
 *
 * `--from=` copies are skipped: they come from an earlier stage, not from the
 * context, so no repo path can change them.
 *
 * @param {string} text Dockerfile contents
 * @returns {string[]}
 */
function copySources(text) {
  const sources = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line)) continue;
    if (line.endsWith('\\')) continue; // continuation — not a shape this repo uses
    const all = line.split(/\s+/).slice(1);
    // Checked BEFORE flags are stripped — filtering first would remove the very
    // token this test looks for and let stage copies through.
    if (all.some((t) => t.startsWith('--from='))) continue;
    const tokens = all.filter((t) => !t.startsWith('--'));
    if (tokens.length < 2) continue;
    sources.push(...tokens.slice(0, -1)); // last token is the destination
  }
  return sources;
}

/**
 * Turn a COPY source into a predicate over repo-relative changed paths.
 *
 * @param {string} src a context-relative COPY source
 * @returns {(p: string) => boolean}
 */
function matcher(src) {
  const clean = src.replace(/\/$/, '');
  if (clean.includes('*')) {
    const rx = new RegExp(`^${clean.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    return (p) => rx.test(p);
  }
  return (p) => p === clean || p.startsWith(`${clean}/`);
}

/**
 * Derive, per service key, the root-level paths whose change must rebuild it.
 *
 * "Root-level" means: named by a COPY in that service's Dockerfile, and inside
 * no service's sourceDir — anything inside one is already caught by the prefix
 * match, and adding it here would double-report.
 *
 * @param {object[]} map from `se-update-code.sh --print-map`
 * @param {string} composeText contents of docker-compose.yml
 * @param {(rel: string) => string|null} readFile repo-relative reader; null if absent
 * @returns {Map<string, ((p: string) => boolean)[]>} service key -> matchers
 */
function rootDependencies(map, composeText, readFile) {
  const contexts = buildContexts(composeText);
  const sourceDirs = map.map((e) => e.sourceDir).filter(Boolean);
  const deps = new Map();

  for (const entry of map) {
    if (!entry.sourceDir || !entry.composeService) continue;
    // Only a repo-root context can name a root file. Every COPY in a
    // service-scoped context is inside that service's own directory, which the
    // prefix match already owns.
    const context = contexts.get(entry.composeService);
    if (context !== '.' && context !== './') continue;

    const text = readFile(`${entry.sourceDir}/Dockerfile`);
    if (!text) continue;

    const roots = copySources(text).filter((src) => {
      if (src === '.' || src.startsWith('/')) return false;
      return !sourceDirs.some((dir) => src === dir || src.startsWith(`${dir}/`));
    });
    if (roots.length) deps.set(entry.key, roots.map(matcher));
  }
  return deps;
}



/**
 * @param {object[]} map from `se-update-code.sh --print-map`
 * @param {string[]} changedPaths repo-relative paths changed by the merge
 * @param {Map<string, ((p: string) => boolean)[]>} rootDeps from rootDependencies()
 * @returns {{include: {key:string, ghcrImage:string, composeService:string, localImage:string}[]}}
 */
function buildMatrix(map, changedPaths, rootDeps = new Map()) {
  const include = [];
  for (const entry of map) {
    if (!entry.sourceDir) continue;
    // The trailing slash is the whole guard: without it "demo_api_server"
    // also claims "demo_api_server_extra/file.js".
    const prefix = `${entry.sourceDir}/`;
    const matchers = rootDeps.get(entry.key) || [];
    const touched = changedPaths.some(
      (p) => p.startsWith(prefix) || matchers.some((m) => m(p)),
    );
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
  const readFile = (rel) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const composePath = path.join(ROOT, 'docker-compose.yml');
  const rootDeps = fs.existsSync(composePath)
    ? rootDependencies(map, fs.readFileSync(composePath, 'utf8'), readFile)
    : new Map();
  const matrix = buildMatrix(map, changedPaths, rootDeps);
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

module.exports = { buildMatrix, main, rootDependencies, buildContexts, copySources, matcher };
