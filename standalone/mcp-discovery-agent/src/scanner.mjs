import { homedir } from 'node:os';
import { join } from 'node:path';
import { discoverCandidates } from './candidates/index.mjs';
import { probeCandidate } from './probe.mjs';
import { redactRecord } from './redaction.mjs';

export async function runScan({ execFile, fsImpl, remoteUrls = [], clientConfigPaths = [], compose, store, probeOptions = {} } = {}) {
  const scanId = `scan-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const discovered = await discoverCandidates({ execFile, fsImpl, remoteUrls, clientConfigPaths, compose });
  const records = [];
  for (const candidate of discovered.candidates) {
    records.push(redactRecord(await probeCandidate(candidate, probeOptions)));
  }
  const completedAt = new Date().toISOString();
  const result = { scanId, startedAt, completedAt, records, diagnostics: discovered.diagnostics };
  if (store) await store.replaceScan(result);
  return result;
}

export function defaultScanOptions(env = process.env) {
  return {
    remoteUrls: String(env.MCP_DISCOVERY_REMOTE_URLS || '').split(',').map((value) => value.trim()).filter(Boolean),
    clientConfigPaths: String(env.MCP_DISCOVERY_CONFIG_PATHS || '').split(',').map((value) => value.trim()).filter(Boolean),
    compose: { host: env.MCP_DISCOVERY_COMPOSE_HOST || '127.0.0.1' },
    filePath: env.MCP_DISCOVERY_STORE_PATH || join(homedir(), '.mcp-discovery', 'inventory.json'),
  };
}
