import { createInventoryRecord } from './inventory.mjs';
import { analyzeToolMetadata } from './security.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

function now() { return new Date().toISOString(); }

async function readJson(response, maxBodyBytes) {
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) throw new Error('response_too_large');
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const data = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(body);
}

async function rpc(endpoint, method, params, { fetchImpl = fetch, signal, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${method}`, method, params }),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('redirect_not_allowed');
  if (response.status === 401 || response.status === 403) throw new Error(`HTTP ${response.status}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await readJson(response, maxBodyBytes);
  if (payload.error) {
    const error = new Error(payload.error.message || 'MCP error');
    error.code = payload.error.code;
    throw error;
  }
  return payload.result || {};
}

export function classifyProbeError(error) {
  const message = error?.message || String(error);
  if (error?.name === 'AbortError' || message === 'timeout') return { status: 'offline', errorCode: 'timeout', message };
  if (/HTTP (401|403)/.test(message)) return { status: 'degraded', errorCode: 'auth_required', message };
  if (message === 'redirect_not_allowed') return { status: 'degraded', errorCode: 'redirect_not_allowed', message };
  if (message === 'response_too_large') return { status: 'degraded', errorCode: 'response_too_large', message };
  if (typeof error?.code === 'number' && error.code === -32601) return { status: 'degraded', errorCode: 'method_not_found', message };
  return { status: 'offline', errorCode: 'probe_failed', message };
}

export async function probeHttpCandidate(candidate, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let discovery;
    try {
      discovery = await rpc(candidate.endpoint, 'server/discover', {}, { ...options, signal: controller.signal });
    } catch (error) {
      if (!(error?.code === -32601 || error?.code === -32602 || /HTTP 404/.test(error.message))) throw error;
      const initialized = await rpc(candidate.endpoint, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-discovery-agent', version: '1.0.0' },
      }, { ...options, signal: controller.signal });
      discovery = {
        supportedVersions: initialized.protocolVersion ? [initialized.protocolVersion] : [],
        capabilities: initialized.capabilities || {},
        serverInfo: initialized.serverInfo || null,
        instructions: initialized.instructions || '',
      };
      await rpc(candidate.endpoint, 'notifications/initialized', {}, { ...options, signal: controller.signal }).catch(() => {});
    }
    const toolsResult = await rpc(candidate.endpoint, 'tools/list', {}, { ...options, signal: controller.signal });
    const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
    return {
      supportedVersions: discovery.supportedVersions || [],
      protocolVersion: discovery.supportedVersions?.[0] || null,
      capabilities: discovery.capabilities || {},
      serverInfo: discovery.serverInfo || discovery._meta?.['io.modelcontextprotocol/serverInfo'] || null,
      instructions: discovery.instructions || '',
      tools,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeCandidate(candidate, options = {}) {
  const record = createInventoryRecord(candidate);
  const attemptedAt = now();
  record.probe.lastAttemptAt = attemptedAt;
  if (!['streamable-http', 'sse'].includes(candidate.transport) || !candidate.endpoint) {
    record.probe.errorCode = 'stdio_unprobed';
    return record;
  }
  const started = Date.now();
  try {
    const result = await probeHttpCandidate(candidate, options);
    const security = analyzeToolMetadata(result.tools);
    return {
      ...record,
      status: 'healthy',
      probe: { lastAttemptAt: attemptedAt, lastSuccessAt: now(), latencyMs: Date.now() - started, errorCode: null },
      serverInfo: result.serverInfo,
      protocolVersion: result.protocolVersion,
      capabilities: result.capabilities,
      instructions: result.instructions,
      tools: result.tools,
      toolMetadataHash: security.toolMetadataHash,
      securityFindings: security.findings,
      lastSeenAt: now(),
    };
  } catch (error) {
    const failure = classifyProbeError(error);
    return { ...record, status: failure.status, probe: { ...record.probe, latencyMs: Date.now() - started, errorCode: failure.errorCode } };
  }
}
