import { normalizeCandidate } from '../inventory.mjs';

function portFromDocker(portText) {
  const match = String(portText || '').match(/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):([0-9]+)->[0-9]+/);
  return match?.[1] || null;
}

export async function discoverCompose(execFile, { host = '127.0.0.1' } = {}) {
  const output = await execFile('docker', ['ps', '--format', '{{json .}}']);
  return String(output).split('\n').filter(Boolean).flatMap((line) => {
    let row;
    try { row = JSON.parse(line); } catch { return []; }
    const labels = Object.fromEntries(String(row.Labels || '').split(',').filter(Boolean).map((entry) => entry.split('=')));
    const service = labels['com.docker.compose.service'];
    if (!service || !/mcp/i.test(service)) return [];
    const port = portFromDocker(row.Ports);
    return [normalizeCandidate({
      displayName: service,
      source: 'compose-service', confidence: 'observed', location: 'local', transport: 'streamable-http',
      endpoint: port ? `http://${host}:${port}/mcp` : null,
      container: { name: row.Names || null, service },
    })];
  });
}
