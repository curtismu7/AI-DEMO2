import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const pagePath = resolve(import.meta.dirname, '../docs/demo-launcher/index.html');
const launcherScriptPath = resolve(import.meta.dirname, './start-demo-launcher.sh');

test('documents the fixed local demo controls without exposing credentials', async () => {
  const html = await readFile(pagePath, 'utf8');

  assert.match(html, /Start LibreChat/);
  assert.match(html, /Check services/);
  assert.match(html, /Open LibreChat/);
  assert.match(html, /local\.ping-devops\.com:4000/);
  assert.match(html, /Policy Guardrails/);
  assert.match(html, /AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE/);
  assert.doesNotMatch(html, /client_secret|access_token|refresh_token/);
});

test('uses only the fixed status endpoint and does not accept external URLs', async () => {
  const html = await readFile(pagePath, 'utf8');
  const endpointRequests = [...html.matchAll(/fetch\((['"])(\/api\/[^'"]+)\1/g)].map((match) => match[2]);

  assert.deepEqual(endpointRequests, ['/api/status', '/api/start']);
  assert.doesNotMatch(html, /URLSearchParams|location\.search|[?&]url=/);
});

test('keeps the launcher wrapper on loopback and starts demo auth dependencies', async () => {
  const script = await readFile(launcherScriptPath, 'utf8');

  assert.match(script, /LAUNCHER_HOST="127\.0\.0\.1"/);
  assert.match(script, /export DEMO_LAUNCHER_HOST="\$\{LAUNCHER_HOST\}"/);
  assert.doesNotMatch(script, /\$\{DEMO_LAUNCHER_HOST/);
  assert.match(script, /\.\/run-docker\.sh optional start demo-auth/);
});
