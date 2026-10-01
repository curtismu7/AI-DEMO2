'use strict';

const { execFile: nodeExecFile } = require('node:child_process');
const nodeFs = require('node:fs');
const path = require('node:path');

// Read-only view of scripts/deploy-live.sh's state for THIS machine's Docker
// stack. deploy-live keeps it under .git/ (per-service markers, a lock
// directory, an append-only restart log). Nothing here writes, takes the lock,
// or runs a deploy.
//
// ponytail: "commits since" counts every commit on disk after a service's
// marker, not only those touching that service. The path->service map lives in
// deploy-live.sh as shell; duplicating it here would drift. If per-service
// accuracy matters, give deploy-live a machine-readable --plan and read that.

const SHA = /^[0-9a-f]{7,40}$/;

// "<iso>  deploy <sha>  restarted: a b  a@<started> ..." — other lines are noise.
function parseRestartLog(text, limit = 5) {
  const entries = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^(\S+Z)\s+deploy\s+([0-9a-f]{7,40})\s+restarted:\s*(.*?)(?:\s{2,}\S+@|$)/.exec(line);
    if (!match) continue;
    entries.push({ at: match[1], sha: match[2].slice(0, 9), services: [...new Set(match[3].split(/\s+/).filter(Boolean))] });
  }
  return entries.slice(-limit).reverse();
}

// "BFF  main checkout   /path" / "UI   <worktree name>   /path"
function parseServedCheckout(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    const match = /^(BFF|UI)\s{2,}(.+?)\s{2,}(\S.*)$/.exec(line.trim());
    return match ? { mount: match[1], checkout: match[2].trim(), isMain: /^main checkout$/i.test(match[2].trim()) } : null;
  }).filter(Boolean);
}

// Services that share a deployed commit are reported together.
function groupServices(markers, behindBySha) {
  const groups = new Map();
  for (const { service, sha } of markers) groups.set(sha, [...(groups.get(sha) || []), service]);
  return [...groups.entries()]
    .map(([sha, services]) => ({ sha: sha.slice(0, 9), services: services.sort(), commitsSince: behindBySha.get(sha) ?? null }))
    .sort((a, b) => (b.commitsSince ?? -1) - (a.commitsSince ?? -1) || a.sha.localeCompare(b.sha));
}

function run(execFile, command, args, cwd) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

function pidAlive(pid, kill = process.kill.bind(process)) {
  try { kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

async function readDeployState({
  repoRoot = path.resolve(__dirname, '../..'),
  fs = nodeFs,
  execFile = nodeExecFile,
  isAlive = pidAlive,
} = {}) {
  const commonDir = (await run(execFile, 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repoRoot))?.trim();
  if (!commonDir) return { available: false };
  const mainCheckout = path.dirname(commonDir);
  const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

  const head = (await run(execFile, 'git', ['rev-parse', 'HEAD'], mainCheckout))?.trim() || null;

  const servicesDir = path.join(commonDir, 'deploy-live', 'services');
  let files = [];
  try { files = fs.readdirSync(servicesDir).filter((name) => name.endsWith('.sha')); } catch {}
  const markers = files
    .map((name) => ({ service: name.slice(0, -4), sha: String(read(path.join(servicesDir, name)) || '').trim() }))
    .filter((marker) => SHA.test(marker.sha));

  const behindBySha = new Map();
  for (const sha of new Set(markers.map((marker) => marker.sha))) {
    const count = head ? await run(execFile, 'git', ['rev-list', '--count', `${sha}..${head}`], mainCheckout) : null;
    if (count !== null && /^\d+\s*$/.test(count)) behindBySha.set(sha, Number(count));
  }

  const lockDir = path.join(commonDir, 'deploy-live.lock');
  let lock = { running: false };
  if (fs.existsSync(lockDir)) {
    const pid = Number(String(read(path.join(lockDir, 'pid')) || '').trim());
    const valid = Number.isSafeInteger(pid) && pid > 0;
    // A lock whose process is gone is a leftover; deploy-live clears it itself.
    lock = { running: valid ? isAlive(pid) : true, pid: valid ? pid : null, stale: valid && !isAlive(pid) };
  }

  const served = parseServedCheckout(await run(execFile, 'bash', [path.join(mainCheckout, 'scripts', 'serve-worktree.sh')], mainCheckout));

  return {
    available: true,
    head: head ? head.slice(0, 9) : null,
    lock,
    groups: groupServices(markers, behindBySha),
    serviceCount: markers.length,
    served,
    recent: parseRestartLog(read(path.join(commonDir, 'deploy-live.restarts'))),
  };
}

// Image builds are ordinary workflow runs; this picks them out of the run list.
function imageBuilds(runs, { workflowName = 'Build images', limit = 5 } = {}) {
  return (runs || [])
    .filter((run) => run.name === workflowName)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, limit)
    .map((run) => ({
      id: Number(run.id),
      title: run.display_title || 'Build images',
      sha: String(run.head_sha || '').slice(0, 9),
      status: run.status || 'unknown',
      conclusion: run.conclusion || null,
      createdAt: run.created_at || null,
      url: run.html_url || '',
    }));
}

module.exports = { groupServices, imageBuilds, parseRestartLog, parseServedCheckout, pidAlive, readDeployState };
