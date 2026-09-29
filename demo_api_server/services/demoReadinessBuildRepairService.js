'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { USE_CASES } = require('../config/useCases');
const repairability = require('../config/demoReadinessRepairability.json');
const { createRepairService, stableJson } = require('./demoReadinessRepairService');
const { redactReadinessValue } = require('./demoReadinessReport');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const MAX_BYTES = 1024 * 1024;
const SOURCE_EXTENSION = /\.(?:[cm]?js|jsx|tsx?|py|groovy|css|html)$/;
const FORBIDDEN_COMPONENT = /^(?:config|data|generated|dist|build|node_modules|secrets?|credentials?|\.git)$/i;
const PROTECTED_PATH = 'demo_api_server/data/step-verification/pingone-admin/ADMIN7.chip.unit-parse.json';
const PRESERVATION_SCOPE = Object.freeze({
  tracked: 'all files except the protected fixture',
  untracked: 'nonignored files and contents',
  ignored: 'not verified',
  excludedPaths: [PROTECTED_PATH],
});

function relativePath(value, { directory = false } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\s\x00-\x1f]/.test(value)
      || path.posix.isAbsolute(value) || value.split('/').some((part) => part === '..' || (!directory && part === '.'))) {
    throw new Error('Path must remain inside the repository');
  }
  if (directory && value === '.') return value;
  if (path.posix.normalize(value) !== value || value.startsWith('-')) throw new Error('Path is not canonical');
  return value;
}

function eligibleSource(ref) {
  relativePath(ref);
  return SOURCE_EXTENSION.test(ref)
    && !ref.split('/').some((part) => FORBIDDEN_COMPONENT.test(part) || part.startsWith('.env'))
    && !/(?:generated|\.gen|\.generated|\.min)\./i.test(path.basename(ref));
}

function declaredRefs(caseRow) {
  const declared = USE_CASES.find((row) => row.id === caseRow?.id);
  if (!declared || !Array.isArray(declared.codeRefs) || declared.codeRefs.length === 0) {
    throw new Error('Case has no checked-in code references');
  }
  if (!Array.isArray(caseRow.codeRefs)
      || stableJson([...caseRow.codeRefs].sort()) !== stableJson([...declared.codeRefs].sort())) {
    throw new Error('Case code references differ from the checked-in declaration');
  }
  const refs = declared.codeRefs.filter(eligibleSource);
  if (!refs.length) throw new Error('Case has no eligible application source references');
  return refs;
}

async function regularFile(root, ref) {
  const resolvedRoot = await fs.realpath(root);
  const filename = path.join(resolvedRoot, ref);
  // Reject symlinks in parent directories as well as symlink files.
  let current = resolvedRoot;
  for (const component of ref.split('/')) {
    current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Source and check paths cannot contain symlinks');
  }
  if (!(await fs.lstat(filename)).isFile()) throw new Error('Code reference must be an existing regular file');
  return filename;
}

function runProcess(command, args, { cwd, input, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { CI: 'true', GIT_TERMINAL_PROMPT: '0' };
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'LANG', 'LC_ALL']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const child = spawn(command, args, { cwd, shell: false, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const collect = (name, chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length > MAX_BYTES) {
        overflow = true;
        child.kill('SIGKILL');
      } else if (name === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut, overflow });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function git(root, args, input) {
  const result = await runProcess('git', args, { cwd: root, input });
  if (result.exitCode !== 0 || result.overflow || result.timedOut) throw new Error('Isolated git operation failed');
  return result.stdout;
}

function hashableSource(ref) {
  return SOURCE_EXTENSION.test(ref)
    && !ref.split('/').some((part) => /^(?:generated|dist|build|node_modules|secrets?|credentials?|\.git)$/i.test(part) || part.startsWith('.env'));
}

async function snapshotPaths(root) {
  // Exclude it in Git's enumeration, then defend again before service file I/O.
  return [...new Set((await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.', ':(top,literal,exclude)' + PROTECTED_PATH])).split('\0'))]
    .filter((ref) => ref && ref !== PROTECTED_PATH).sort();
}

async function snapshotFile(root, ref) {
  if (path.posix.isAbsolute(ref) || ref.includes('\0') || ref.split('/').some((part) => part === '..' || part === '.' || !part)) {
    throw new Error('Preservation snapshot path is outside the repository');
  }
  const resolvedRoot = await fs.realpath(root);
  let filename = resolvedRoot;
  const parts = ref.split('/');
  for (const part of parts.slice(0, -1)) {
    filename = path.join(filename, part);
    let stat;
    try { stat = await fs.lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') return { ref, type: 'missing' }; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Preservation snapshot parent must be a real directory');
  }
  filename = path.join(filename, parts.at(-1));
  let stat;
  try { stat = await fs.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return { ref, type: 'missing' }; throw error; }
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) throw new Error('Preservation snapshot cannot verify symlink paths');
  if (!stat.isFile()) throw new Error('Preservation snapshot contains an unsupported file type');
  const content = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filename)) content.update(chunk);
  return { ref, type: 'file', mode, content: content.digest('hex') };
}

async function filesHash(root, { sourceOnly = false } = {}) {
  const files = (await snapshotPaths(root)).filter((ref) => !sourceOnly || hashableSource(ref));
  if (sourceOnly && !files.length) throw new Error('Repository has no application source files to hash');
  const hash = crypto.createHash('sha256');
  for (const ref of files) {
    hash.update(stableJson(await snapshotFile(root, ref))).update('\0');
  }
  return hash.digest('hex');
}

const sourceHash = (root) => filesHash(root, { sourceOnly: true });

async function callerSnapshot(root) {
  const indexPath = (await git(root, ['rev-parse', '--git-path', 'index'])).trim();
  return {
    head: (await git(root, ['rev-parse', 'HEAD'])).trim(),
    files: await filesHash(root),
    index: crypto.createHash('sha256').update(await fs.readFile(path.resolve(root, indexPath))).digest('hex'),
  };
}

function validatePlan(testPlan) {
  if (!Array.isArray(testPlan) || testPlan.length === 0) throw new Error('A trusted focused test/build plan is required');
  return testPlan.map((entry) => {
    if (!entry || Object.keys(entry).some((key) => !['command', 'args', 'cwd'].includes(key))
        || typeof entry.command !== 'string' || !entry.command || /[\x00-\x1f]/.test(entry.command)
        || !Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new Error('Checks must be trusted command/args/cwd argv entries');
    }
    return { command: entry.command, args: [...entry.args], cwd: relativePath(entry.cwd || '.', { directory: true }) };
  });
}

// Accept existing-file unified text diffs only. Git never sees provider metadata
// for modes, renames, binary payloads, quoted paths, or executable instructions.
function validatePatch(patch, refs) {
  if (typeof patch !== 'string' || !patch || Buffer.byteLength(patch) > MAX_BYTES || patch.includes('\0')) {
    throw new Error('Patch provider must return bounded unified-diff text only');
  }
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let index = 0;
  const changed = new Set();
  while (index < lines.length) {
    let metadataPath;
    if (lines[index].startsWith('diff --git ')) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[index++]);
      if (!match || match[1] !== match[2]) throw new Error('Patch must modify existing paths without renames');
      metadataPath = match[1];
      if (/^index [a-f0-9]+\.\.[a-f0-9]+(?: 100644| 100755)?$/.test(lines[index] || '')) index += 1;
    }
    const oldPath = /^--- a\/(\S+)$/.exec(lines[index++] || '');
    const newPath = /^\+\+\+ b\/(\S+)$/.exec(lines[index++] || '');
    if (!oldPath || !newPath || oldPath[1] !== newPath[1] || (metadataPath && metadataPath !== oldPath[1])) {
      throw new Error('Patch must contain matching existing-file headers');
    }
    const ref = relativePath(oldPath[1]);
    if (!eligibleSource(ref) || !refs.includes(ref) || changed.has(ref)) throw new Error('Patch path is outside the declared source allowlist');
    changed.add(ref);
    let hunks = 0;
    while (/^@@ /.test(lines[index] || '')) {
      const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/.exec(lines[index++]);
      if (!hunk) throw new Error('Patch hunk is malformed');
      let oldCount = hunk[1] === undefined ? 1 : Number(hunk[1]);
      let newCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
      while (oldCount > 0 || newCount > 0) {
        const line = lines[index++];
        if (line === '\\ No newline at end of file') continue;
        if (typeof line !== 'string' || ![' ', '-', '+'].includes(line[0])) throw new Error('Patch contains commands or malformed hunk data');
        if (line[0] !== '+') oldCount -= 1;
        if (line[0] !== '-') newCount -= 1;
        if (oldCount < 0 || newCount < 0) throw new Error('Patch hunk counts do not match');
      }
      if (lines[index] === '\\ No newline at end of file') index += 1;
      hunks += 1;
    }
    if (!hunks) throw new Error('Patch contains no source hunk');
  }
  return [...changed];
}

function createBuildRepairService({ repositoryRoot = DEFAULT_ROOT } = {}) {
  const root = path.resolve(repositoryRoot);

  async function validateConfigOnlyRecovery({ caseRow, driftFixture, adapters = {} } = {}) {
    const result = { status: 'blocked', preservationScope: PRESERVATION_SCOPE };
    let directory;
    let fixture;
    let snapshot;
    try {
      declaredRefs(caseRow);
      if (repairability.driftClasses?.[driftFixture?.repairClass]?.repairMode !== 'automatic'
          || ['createFixture', 'introduceDrift', 'repairAdapters', 'sourceReaders', 'runScenario', 'disposeFixture'].some((method) => typeof adapters[method] !== 'function')) {
        throw new Error('Configuration proof requires a supported disposable fixture adapter');
      }
      snapshot = await callerSnapshot(root);
      result.callerHashBefore = snapshot.files;
      result.sourceHashBefore = await sourceHash(root);
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-config-proof-'));
      fixture = await adapters.createFixture({ directory, driftFixture });
      const finding = await adapters.introduceDrift({ fixture, driftFixture, caseRow });
      if (finding?.repairCandidate?.repairClass !== driftFixture.repairClass) throw new Error('Fixture drift does not match its declared repair class');
      result.before = await adapters.runScenario({ fixture, caseRow });
      if (result.before?.status !== 'fail') throw new Error('Fixture did not reproduce a deterministic scenario failure');
      const repairAdapters = { ...adapters.repairAdapters(fixture) };
      const sourceReaders = adapters.sourceReaders(fixture);
      if (driftFixture.repairClass === 'demo-feature-flag') {
        const flagAdapter = repairAdapters['demo-feature-flag'];
        repairAdapters['demo-feature-flag'] = {
          ...flagAdapter,
          readback: async (args) => {
            const value = await flagAdapter.readback(args);
            if (stableJson(value) === stableJson(finding.repairCandidate.expected)) {
              result.after = await adapters.runScenario({ fixture, caseRow, workerContext: args.workerContext });
            }
            return value;
          },
        };
      }
      const confirmation = {};
      const service = createRepairService({ adapters: repairAdapters, sourceReaders, verifyAdminConfirmation: async (assertion) => assertion === confirmation ? { subject: 'disposable-fixture' } : null });
      const targets = [{ id: 'local', kind: 'local' }];
      result.preview = service.planRepairs({ findings: [finding], targets });
      if (result.preview.blocked.length || result.preview.changes.length !== 1) throw new Error('Fixture repair is blocked by the supported repair contract');
      result.repair = await service.applyRepairs({ digest: result.preview.digest, confirmedBy: confirmation, targets });
      if (driftFixture.repairClass !== 'demo-feature-flag') result.after = await adapters.runScenario({ fixture, caseRow });
      if (result.after?.status !== 'pass') throw new Error('Configuration repair did not fix the affected scenario');
      result.status = 'pass';
    } catch (error) {
      result.reason = error.message || 'Configuration proof failed';
      if (error.repairEvidence) result.repairEvidence = error.repairEvidence;
    } finally {
      try {
        if (fixture) await adapters.disposeFixture({ fixture });
      } catch (error) { result.status = 'blocked'; result.reason = 'Disposable fixture cleanup failed'; }
      try {
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      } catch (error) { result.status = 'blocked'; result.reason = 'Disposable fixture directory cleanup failed'; }
      if (result.sourceHashBefore) {
        try {
          result.sourceHashAfter = await sourceHash(root);
          if (result.sourceHashAfter !== result.sourceHashBefore) { result.status = 'blocked'; result.reason = 'Application source hash changed during configuration proof'; }
        } catch (error) { result.status = 'blocked'; result.reason = 'Application source hash could not be verified'; }
      }
      if (snapshot) {
        try {
          const after = await callerSnapshot(root);
          result.callerHashAfter = after.files;
          if (stableJson(after) !== stableJson(snapshot)) { result.status = 'blocked'; result.reason = 'Caller checkout or index changed during configuration proof'; }
        } catch (error) { result.status = 'blocked'; result.reason = 'Caller checkout preservation could not be verified'; }
      }
    }
    return redactReadinessValue(result);
  }

  async function prepareSourceFix({ caseRow, sanitizedFailure, baseRevision, patchProvider, testPlan } = {}) {
    const result = { status: 'blocked', evidence: [], preservationScope: PRESERVATION_SCOPE };
    let directory;
    let worker;
    let workerAdded = false;
    let snapshot;
    try {
      const refs = declaredRefs(caseRow);
      const plan = validatePlan(testPlan);
      if (sanitizedFailure?.kind !== 'source-defect' || sanitizedFailure.configRecovery?.status === 'pass') throw new Error('Only an unresolved source defect can request a build-time patch');
      if (typeof patchProvider !== 'function') throw new Error('An offline unified-diff patch provider is required');
      if (typeof baseRevision !== 'string' || !baseRevision || baseRevision.startsWith('-') || /[\s\x00-\x1f]/.test(baseRevision)) throw new Error('A valid base revision is required');
      const revision = (await git(root, ['rev-parse', '--verify', baseRevision + '^{commit}'])).trim();
      snapshot = await callerSnapshot(root);
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-source-candidate-'));
      worker = path.join(directory, 'worktree');
      await git(root, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', worker, revision]);
      workerAdded = true;
      for (const ref of refs) await regularFile(worker, ref);
      for (const check of plan) {
        let current = worker;
        if (check.cwd !== '.') for (const part of check.cwd.split('/')) {
          current = path.join(current, part);
          const stat = await fs.lstat(current);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Check cwd must be a real directory inside the candidate');
        }
      }
      const patch = await patchProvider({ caseRow: { id: caseRow.id, codeRefs: refs }, sanitizedFailure: redactReadinessValue(sanitizedFailure), baseRevision: revision, worktreePath: worker });
      const changed = validatePatch(patch, refs);
      if ((await git(worker, ['status', '--porcelain'])).trim()) throw new Error('Provider changed the candidate instead of returning patch data');
      await git(worker, ['apply', '--check', '--whitespace=error-all', '-'], patch);
      await git(worker, ['apply', '--whitespace=error-all', '-'], patch);
      const diff = await git(worker, ['diff', '--no-ext-diff', '--no-textconv', '--binary']);
      if (!diff.trim()) throw new Error('Patch did not change application source');
      for (const check of plan) {
        const evidence = await runProcess(check.command, check.args, { cwd: path.join(worker, check.cwd) });
        result.evidence.push(redactReadinessValue({ ...check, ...evidence }));
        if (evidence.exitCode !== 0 || evidence.timedOut || evidence.overflow) throw new Error('Candidate failed its trusted focused test/build plan');
      }
      if ((await git(worker, ['rev-parse', 'HEAD'])).trim() !== revision
          || (await git(worker, ['diff', '--cached', '--no-ext-diff', '--no-textconv'])).trim()
          || (await git(worker, ['ls-files', '--others', '--exclude-standard', '-z'])).trim()
          || await git(worker, ['diff', '--no-ext-diff', '--no-textconv', '--binary']) !== diff) {
        throw new Error('Candidate checks changed source, staged files, committed, or left untracked files');
      }
      result.status = 'verified';
      result.baseRevision = revision;
      result.changedPaths = changed;
      result.patch = redactReadinessValue(diff);
      result.diff = result.patch;
      result.reviewerAction = 'Review the uncommitted patch and focused evidence; apply through the normal reviewed source change workflow.';
    } catch (error) { result.reason = error.message || 'Source candidate failed'; }
    finally {
      try {
        if (workerAdded) await git(root, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'remove', '--force', worker]);
      } catch (error) { result.status = 'blocked'; result.reason = 'Candidate worktree cleanup failed'; }
      try {
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      } catch (error) { result.status = 'blocked'; result.reason = 'Candidate directory cleanup failed'; }
      if (snapshot) {
        try {
          if (stableJson(await callerSnapshot(root)) !== stableJson(snapshot)) { result.status = 'blocked'; result.reason = 'Caller checkout or index changed during source validation'; }
        } catch (error) { result.status = 'blocked'; result.reason = 'Caller checkout preservation could not be verified'; }
      }
      if (result.status !== 'verified') { delete result.patch; delete result.diff; delete result.reviewerAction; }
    }
    return redactReadinessValue(result);
  }

  return { validateConfigOnlyRecovery, prepareSourceFix };
}

const defaultService = createBuildRepairService();
module.exports = { createBuildRepairService, ...defaultService };
