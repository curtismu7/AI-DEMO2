'use strict';

const { execFile: nodeExecFile } = require('node:child_process');
const path = require('node:path');
const { run } = require('./deploy-state');

// Read-only view of what the SE US cluster is running, per service: how many
// files in the service's source folder changed between its image's commit and
// origin/main. Only `kubectl get`, `git` and `se-update-code.sh --print-map`.
//
// The service -> source folder map comes from se-update-code.sh so it cannot
// drift. Images with no entry there (tier-manager, mock apps, third-party,
// :latest) are reported as "cannot tell", never as in sync.

const CONTEXT = 'us';
const NAMESPACE = 'ping-devops-cmuir';
const APP_IMAGE = /\/(ai-demo-[a-z0-9-]+):sha-([0-9a-f]{40})$/;

// One marker per app image on a running deployment; a pod's sidecar images count too.
function parseDeployments(json) {
  const markers = [];
  const seen = new Set();
  for (const item of json?.items || []) {
    for (const container of item?.spec?.template?.spec?.containers || []) {
      const match = APP_IMAGE.exec(String(container.image || ''));
      if (!match || (item.spec.replicas || 0) === 0) continue;
      const key = `${match[1]}@${match[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ image: match[1], service: match[1].replace(/^ai-demo-/, ''), sha: match[2] });
    }
  }
  return markers;
}

async function readSeDeploy({ repoRoot = path.resolve(__dirname, '../..'), execFile = nodeExecFile } = {}) {
  const raw = await run(execFile, 'kubectl', ['--context', CONTEXT, '-n', NAMESPACE, 'get', 'deploy', '-o', 'json', '--request-timeout=15s'], repoRoot);
  if (raw === null) return { available: false };
  let markers;
  try { markers = parseDeployments(JSON.parse(raw)); } catch { return { available: false }; }

  const head = (await run(execFile, 'git', ['rev-parse', 'origin/main'], repoRoot))?.trim() || null;
  let sourceDirs = new Map();
  try {
    const map = JSON.parse(await run(execFile, 'bash', [path.join(repoRoot, 'se-update-code.sh'), '--print-map'], repoRoot));
    sourceDirs = new Map(map.map((entry) => [entry.ghcrImage, entry.sourceDir]));
  } catch {}

  const outOfDate = [];
  const unknown = [];
  const current = [];
  for (const { image, service, sha } of markers) {
    const dir = sourceDirs.get(image);
    const diff = dir && head ? await run(execFile, 'git', ['diff', '--name-only', sha, head, '--', dir], repoRoot) : null;
    if (diff === null) unknown.push({ service, sha: sha.slice(0, 9) });
    else if (diff.trim()) outOfDate.push({ service, sha: sha.slice(0, 9), files: diff.trim().split(/\r?\n/).length });
    else current.push(service);
  }
  const bySvc = (a, b) => a.service.localeCompare(b.service);
  return {
    available: true,
    head: head ? head.slice(0, 9) : null,
    outOfDate: outOfDate.sort(bySvc),
    unknown: unknown.sort(bySvc),
    // A service behind in any one deployment is not in sync, whatever its others say.
    current: [...new Set(current)].filter((service) => !outOfDate.some((item) => item.service === service)).sort(),
  };
}

module.exports = { parseDeployments, readSeDeploy };
