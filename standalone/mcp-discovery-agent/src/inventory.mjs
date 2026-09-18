import { createHash } from 'node:crypto';

const SOURCES = new Set(['compose-service', 'host-process', 'listener', 'client-config', 'remote-url']);
const CONFIDENCE = new Set(['observed', 'inferred', 'configured']);
const LOCATIONS = new Set(['local', 'remote']);
const TRANSPORTS = new Set(['streamable-http', 'sse', 'stdio', 'unknown']);

function first(value, fallback) {
  return value === undefined ? fallback : value;
}

export function normalizeCandidate(input = {}) {
  const candidate = {
    displayName: String(first(input.displayName, input.name || 'Unnamed MCP candidate')),
    source: SOURCES.has(input.source) ? input.source : 'listener',
    confidence: CONFIDENCE.has(input.confidence) ? input.confidence : 'inferred',
    location: LOCATIONS.has(input.location) ? input.location : 'local',
    transport: TRANSPORTS.has(input.transport) ? input.transport : 'unknown',
    endpoint: input.endpoint ? String(input.endpoint) : null,
    process: input.process ? { pid: input.process.pid ?? null, command: input.process.command ?? null } : null,
    container: input.container ? { name: input.container.name ?? null, service: input.container.service ?? null } : null,
  };
  const identity = JSON.stringify([
    candidate.source,
    candidate.location,
    candidate.endpoint,
    candidate.process?.pid ?? null,
    candidate.container?.name ?? null,
    candidate.container?.service ?? null,
    candidate.displayName,
  ]);
  candidate.id = `mcp-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
  return candidate;
}

export function createInventoryRecord(candidate) {
  return {
    ...candidate,
    status: 'candidate',
    probe: { lastAttemptAt: null, lastSuccessAt: null, latencyMs: null, errorCode: null },
    serverInfo: null,
    protocolVersion: null,
    capabilities: {},
    instructions: '',
    tools: [],
    toolMetadataHash: null,
    securityFindings: [],
    lastSeenAt: null,
  };
}
