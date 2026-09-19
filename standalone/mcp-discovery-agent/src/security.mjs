import { createHash } from 'node:crypto';
import { scan } from '../../../standalone/mcp-scanner/scanner.mjs';

function canonicalTools(tools) {
  return JSON.stringify((tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || {},
  })).sort((a, b) => a.name.localeCompare(b.name)));
}

export function analyzeToolMetadata(tools, scanner = scan) {
  return {
    findings: scanner(tools),
    toolMetadataHash: `sha256:${createHash('sha256').update(canonicalTools(tools)).digest('hex')}`,
  };
}
