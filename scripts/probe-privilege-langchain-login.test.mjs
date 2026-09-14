import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, parseHeaders } from './probe-privilege-langchain-login.mjs';

test('parseHeaders reads the final HTTP response block', () => {
  const parsed = parseHeaders(
    'HTTP/1.1 200 Connection established\r\n\r\n' +
    'HTTP/2 401\r\nwww-authenticate: Bearer authorization_uri="https://example/authorize"\r\n\r\n',
  );
  assert.equal(parsed.status, 401);
  assert.match(parsed.headers['www-authenticate'], /authorization_uri/);
});

test('classify accepts the expected healthy bootstrap shape', () => {
  assert.deepEqual(classify({
    base: 401,
    card: 200,
    rpc: 401,
    authorizationUri: 'https://example/authorize',
    resourceMetadata: 'https://example/metadata',
    metadata: 200,
    k8s: true,
  }), []);
});

test('classify identifies missing OAuth bootstrap fields', () => {
  const failures = classify({ card: 200, base: 404, rpc: 401, metadata: 0, k8s: true });
  assert.deepEqual(failures, [
    'OAuth challenge has no authorization_uri.',
    'OAuth challenge has no resource_metadata URL.',
  ]);
});
