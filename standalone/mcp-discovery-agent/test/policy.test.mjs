import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTarget } from '../src/policy.mjs';
import { redactRecord } from '../src/redaction.mjs';

test('allows explicit public HTTPS remote URL', () => {
  const result = evaluateTarget('https://mcp.example.com/mcp', { scope: 'remote' });
  assert.equal(result.allowed, true);
  assert.equal(result.normalizedUrl, 'https://mcp.example.com/mcp');
});

test('rejects private remote URL but permits local adapter loopback', () => {
  assert.equal(evaluateTarget('http://127.0.0.1:8080/mcp', { scope: 'remote' }).allowed, false);
  assert.equal(evaluateTarget('http://127.0.0.1:8080/mcp', { scope: 'local-adapter' }).allowed, true);
});

test('rejects cloud metadata and credentials in remote URL', () => {
  assert.equal(evaluateTarget('http://169.254.169.254/latest/meta-data', { scope: 'remote' }).allowed, false);
  assert.equal(evaluateTarget('https://user:password@mcp.example.com/mcp', { scope: 'remote' }).allowed, false);
});

test('redacts secrets from inventory records', () => {
  const redacted = redactRecord({
    endpoint: 'https://mcp.example.com/mcp?token=secret&safe=yes',
    process: { pid: 12, command: 'node server --api-key=secret --safe=yes' },
    headers: { Authorization: 'Bearer secret', Cookie: 'sid=secret' },
    environment: { API_KEY: 'secret' },
  });

  assert.equal(redacted.endpoint, 'https://mcp.example.com/mcp?safe=yes');
  assert.equal(redacted.process.command, 'node server --api-key=[REDACTED] --safe=yes');
  assert.deepEqual(redacted.headers, undefined);
  assert.deepEqual(redacted.environment, undefined);
});
