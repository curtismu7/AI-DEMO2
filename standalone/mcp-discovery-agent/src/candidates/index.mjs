import { discoverProcesses } from './processes.mjs';
import { discoverListeners } from './listeners.mjs';
import { discoverCompose } from './compose.mjs';
import { discoverClientConfigs } from './clientConfig.mjs';
import { discoverRemoteUrls } from './remoteUrls.mjs';
import { normalizeCandidate } from '../inventory.mjs';

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = candidate.endpoint || `${candidate.source}:${candidate.process?.pid || candidate.process?.command || candidate.container?.name || candidate.id}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...candidate, sources: [candidate.source] });
      continue;
    }
    current.sources = [...new Set([...current.sources, candidate.source])];
    if (candidate.confidence === 'observed') current.confidence = 'observed';
    current.container ||= candidate.container;
    current.process ||= candidate.process;
  }
  return [...byKey.values()].map((candidate) => normalizeCandidate(candidate));
}

export async function discoverCandidates({ execFile, fsImpl, clientConfigPaths = [], remoteUrls = [], compose = {} } = {}) {
  const diagnostics = [];
  const sources = [];
  for (const [name, fn] of [
    ['processes', () => discoverProcesses(execFile)],
    ['listeners', () => discoverListeners(execFile)],
    ['compose', () => discoverCompose(execFile, compose)],
    ['client-config', () => discoverClientConfigs(fsImpl, clientConfigPaths)],
  ]) {
    try { sources.push(...await fn()); } catch (error) { diagnostics.push({ source: name, reason: 'source_failed', message: error.message }); }
  }
  const remote = await discoverRemoteUrls(remoteUrls);
  diagnostics.push(...remote.diagnostics);
  sources.push(...remote.candidates);
  return { candidates: mergeCandidates(sources), diagnostics };
}
