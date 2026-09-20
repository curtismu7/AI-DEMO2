import { normalizeCandidate } from '../inventory.mjs';

export async function discoverListeners(execFile) {
  const output = await execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpctn']);
  let pid = null;
  let command = null;
  return String(output).split('\n').flatMap((line) => {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('c')) command = line.slice(1);
    if (!line.startsWith('n')) return [];
    const endpoint = line.slice(1).match(/^([^:]+):(\d+)$/);
    if (!endpoint) return [];
    const host = endpoint[1] === '*' ? '127.0.0.1' : endpoint[1];
    return [normalizeCandidate({
      displayName: `${command || 'Listener'} ${endpoint[2]}`,
      source: 'listener', confidence: 'observed', location: 'local', transport: 'streamable-http',
      endpoint: `http://${host}:${endpoint[2]}/mcp`, process: { pid, command },
    })];
  });
}
