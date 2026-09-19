import { readFile } from 'node:fs/promises';
import { normalizeCandidate } from '../inventory.mjs';

export async function discoverClientConfigs(fsImpl = { readFile }, paths = []) {
  const candidates = [];
  for (const path of paths) {
    let document;
    try { document = JSON.parse(await fsImpl.readFile(path, 'utf8')); } catch { continue; }
    for (const [name, config] of Object.entries(document.mcpServers || {})) {
      if (config.url) {
        candidates.push(normalizeCandidate({
          displayName: name, source: 'client-config', confidence: 'configured', location: 'remote',
          transport: 'streamable-http', endpoint: config.url,
        }));
      } else if (config.command) {
        candidates.push(normalizeCandidate({
          displayName: name, source: 'client-config', confidence: 'configured', location: 'local',
          transport: 'stdio', process: { command: [config.command, ...(config.args || [])].join(' ') },
        }));
      }
    }
  }
  return candidates;
}
