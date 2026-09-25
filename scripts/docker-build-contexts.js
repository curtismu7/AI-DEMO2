#!/usr/bin/env node
'use strict';

// BuildKit's root-context allowlists still make macOS walk ignored dependency
// trees. Stage only the files the two slow images consume, using hard links so
// this does not duplicate their contents on disk. Keep the contexts disposable:
// run-docker.sh removes the staging directory when the command exits.

const fs = require('fs');
const path = require('path');

const [repoRootArg, outputArg, ...requested] = process.argv.slice(2);
if (!repoRootArg || !outputArg || requested.length === 0) {
  console.error('Usage: docker-build-contexts.js <repo-root> <output-dir> <bff|langchain>...');
  process.exit(2);
}

const repoRoot = path.resolve(repoRootArg);
const outputRoot = path.resolve(outputArg);
const requestedContexts = new Set(requested);
for (const name of requestedContexts) {
  if (!['bff', 'langchain', 'authz', 'gateway'].includes(name)) {
    console.error(`Unknown context: ${name}`);
    process.exit(2);
  }
}

const COMMON_IGNORED_DIRS = new Set([
  '.git', '.worktrees', '.claude', 'node_modules', '.venv', 'venv', 'env',
  'certs', 'coverage', '.cache', '.npm', '.vite', '.turbo', 'test-results',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
]);
const { CODEBASE_PIECES, collectFiles } = require(path.join(
  repoRoot,
  'demo_api_server/services/defaultCodebaseIndexer.js',
));

function ignoredFile(name, relativePath) {
  if (name === '.DS_Store' || name.endsWith('.log') || /\.(py[cod]|pem|key|p12|pfx|crt|cer|enc)$/i.test(name)) return true;
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true;
  if (/^(credentials|secrets).*\.json$/i.test(name)) return true;
  if (relativePath.split(path.sep).includes('certs')) return true;
  return false;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function linkOrCopy(source, destination) {
  ensureDir(path.dirname(destination));
  try {
    fs.linkSync(source, destination);
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    if (!['EXDEV', 'EPERM', 'EACCES', 'EMLINK'].includes(err.code)) throw err;
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
  }
  return true;
}

function copyTree(source, destination, options = {}) {
  const root = path.resolve(source);
  if (!fs.existsSync(root)) return;
  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(relative, entry.name);
      const src = path.join(current, entry.name);
      const dest = path.join(destination, rel);
      if (entry.isDirectory()) {
        if (COMMON_IGNORED_DIRS.has(entry.name) || options.ignoredDirs?.has(rel)) continue;
        ensureDir(dest);
        visit(src, rel);
      } else if (entry.isFile()) {
        if (ignoredFile(entry.name, rel)) continue;
        if (options.codeOnly) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!CODE_INDEX_EXTENSIONS.has(ext) || /\.min\.(js|css)$/i.test(entry.name) || entry.name === 'package-lock.json') continue;
          if (fs.statSync(src).size > 48 * 1024) continue;
        }
        linkOrCopy(src, dest);
      }
    }
  }
  visit(root, '');
}

function copyFile(sourceRelative, contextRoot, destinationRelative = sourceRelative) {
  const source = path.join(repoRoot, sourceRelative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required Docker build input is missing: ${sourceRelative}`);
  }
  if (ignoredFile(path.basename(source), sourceRelative)) {
    throw new Error(`Refusing to stage a protected build input: ${sourceRelative}`);
  }
  linkOrCopy(source, path.join(contextRoot, destinationRelative));
}

function copyIndexSources(contextRoot) {
  const indexedFiles = new Set();
  for (const piece of CODEBASE_PIECES) {
    // Use the application's own collector so the baked source tree contains
    // exactly the files that its default indexer can consume.
    for (const file of collectFiles(repoRoot, piece.roots)) indexedFiles.add(file.path);
  }
  for (const relative of indexedFiles) {
    // The complete BFF app tree is also copied into /app. Keep this source copy
    // in sync with it instead of creating a second hard link for every file.
    if (relative.startsWith(`demo_api_server${path.sep}`) || relative === 'demo_api_server') continue;
    if (ignoredFile(path.basename(relative), relative)) continue;
    copyFile(relative, contextRoot);
  }
}

function countContextFiles(root) {
  let files = 0;
  let bytes = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) { files++; bytes += fs.statSync(full).size; }
    }
  }
  visit(root);
  return { files, bytes };
}

function stageBff(destination) {
  ensureDir(destination);
  copyTree(path.join(repoRoot, 'demo_api_server'), path.join(destination, 'demo_api_server'), {
    ignoredDirs: new Set([
      'bin', 'logs', 'tests', '__tests__',
      'data/backups', 'data/persistent', 'data/sessions-lmdb',
      'data/vertical-store', 'data/verticals',
    ]),
  });
  for (const file of ['scope-topology.json', 'service-topology.json', 'llm-timeouts.json']) copyFile(file, destination);
  copyTree(path.join(repoRoot, 'docs'), path.join(destination, 'docs'));
  ensureDir(path.join(destination, 'graphify-out'));
  for (const name of fs.readdirSync(path.join(repoRoot, 'graphify-out'))) {
    if (name.endsWith('.kb.json')) copyFile(path.join('graphify-out', name), destination);
  }
  copyFile('demo_llm_proxy/modelCatalog.js', destination);
  copyFile('snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json', destination);
  copyIndexSources(destination);

  const stats = countContextFiles(destination);
  console.log(`BFF staged context: ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
}

function stageLangchain(destination) {
  ensureDir(destination);
  const service = 'langchain_agent';
  for (const file of ['Dockerfile', 'Dockerfile.dockerignore', 'requirements.txt', '.env.example']) {
    copyFile(path.join(service, file), destination);
  }
  for (const tree of ['src', 'scripts', 'repo-src']) {
    copyTree(path.join(repoRoot, service, tree), path.join(destination, service, tree));
  }
  const dbDir = path.join(repoRoot, service);
  for (const name of fs.readdirSync(dbDir)) {
    if (name.startsWith('codegraph.db')) copyFile(path.join(service, name), destination);
  }
  copyFile('scripts/build-codegraph.py', destination);

  const stats = countContextFiles(destination);
  console.log(`LangChain staged context: ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
}

// Small root-context images: copy only the paths their Dockerfiles declare.
function stageAuthz(destination) {
  ensureDir(destination);
  const service = 'demo_authz_server';
  copyTree(path.join(repoRoot, service), path.join(destination, service));
  copyFile('scope-topology.json', destination);
  for (const file of [
    'snapshots/gen-authorize-snapshot.js',
    'snapshots/intentGovernancePolicy.js',
    'snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json',
  ]) copyFile(file, destination);

  const stats = countContextFiles(destination);
  console.log(`Authz staged context: ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
}

function stageGateway(destination) {
  ensureDir(destination);
  const service = 'demo_mcp_gateway';
  copyTree(path.join(repoRoot, service), path.join(destination, service));
  copyFile('scope-topology.json', destination);
  copyFile('mcp-tool-schemas.json', destination);
  copyTree(path.join(repoRoot, 'oauth-mcp/openapi'), path.join(destination, 'oauth-mcp', 'openapi'));
  copyTree(path.join(repoRoot, 'demo_mcp_resource_server/openapi'), path.join(destination, 'demo_mcp_resource_server', 'openapi'));

  const stats = countContextFiles(destination);
  console.log(`Gateway staged context: ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
}

fs.mkdirSync(outputRoot, { recursive: true });
if (requestedContexts.has('bff')) stageBff(path.join(outputRoot, 'bff'));
if (requestedContexts.has('langchain')) stageLangchain(path.join(outputRoot, 'langchain'));
if (requestedContexts.has('authz')) stageAuthz(path.join(outputRoot, 'authz'));
if (requestedContexts.has('gateway')) stageGateway(path.join(outputRoot, 'gateway'));
