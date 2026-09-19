import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryRecord, normalizeCandidate } from '../src/inventory.mjs';

test('normalizes a compose HTTP candidate with stable identity fields', () => {
  const candidate = normalizeCandidate({
    displayName: 'MCP Banking Server',
    source: 'compose-service',
    confidence: 'observed',
    location: 'local',
    transport: 'streamable-http',
    endpoint: 'http://127.0.0.1:8080/mcp',
    container: { name: 'ai-demo-mcp-server', service: 'mcp-server' },
  });

  assert.equal(candidate.displayName, 'MCP Banking Server');
  assert.equal(candidate.source, 'compose-service');
  assert.equal(candidate.endpoint, 'http://127.0.0.1:8080/mcp');
  assert.match(candidate.id, /^mcp-[a-f0-9]{16}$/);
  assert.deepEqual(candidate.process, null);
});

test('creates an inventory record with honest unprobed defaults', () => {
  const record = createInventoryRecord(normalizeCandidate({
    displayName: 'local stdio server',
    source: 'host-process',
    confidence: 'inferred',
    location: 'local',
    transport: 'stdio',
    process: { pid: 42, command: 'node server.mjs' },
  }));

  assert.equal(record.status, 'candidate');
  assert.equal(record.probe.lastAttemptAt, null);
  assert.deepEqual(record.tools, []);
  assert.deepEqual(record.securityFindings, []);
  assert.equal(record.serverInfo, null);
  assert.equal(record.endpoint, null);
});
