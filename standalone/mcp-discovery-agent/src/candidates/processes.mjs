import { normalizeCandidate } from '../inventory.mjs';

const MCP_HINT = /\b(?:mcp|model[-_ ]context[-_ ]protocol)\b/i;

export async function discoverProcesses(execFile) {
  const output = await execFile('ps', ['-axo', 'pid=,command=']);
  return String(output).split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || !MCP_HINT.test(match[2])) return [];
    return [normalizeCandidate({
      displayName: `Host process ${match[1]}`,
      source: 'host-process', confidence: 'inferred', location: 'local', transport: 'stdio',
      process: { pid: Number(match[1]), command: match[2] },
    })];
  });
}
