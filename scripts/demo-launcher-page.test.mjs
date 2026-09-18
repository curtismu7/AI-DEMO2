import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const pagePath = resolve(import.meta.dirname, '../docs/demo-launcher/index.html');
const launcherScriptPath = resolve(import.meta.dirname, './start-demo-launcher.sh');

test('documents the fixed local demo controls without exposing credentials', async () => {
  const html = await readFile(pagePath, 'utf8');

  assert.match(html, /Start LibreChat/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /Check services/);
  assert.match(html, /Open LibreChat/);
  assert.match(html, /href="http:\/\/localhost:3080"/);
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

test('keeps the launcher wrapper on loopback, starts every fixed dependency, and waits for service readiness', async () => {
  const script = await readFile(launcherScriptPath, 'utf8');

  assert.match(script, /LAUNCHER_HOST="127\.0\.0\.1"/);
  assert.match(script, /export DEMO_LAUNCHER_HOST="\$\{LAUNCHER_HOST\}"/);
  assert.doesNotMatch(script, /\$\{DEMO_LAUNCHER_HOST/);
  assert.match(script, /\.\/run-docker\.sh optional start demo-auth/);
  assert.match(script, /docker compose -f librechat\/docker-compose\.yml up -d api oauth-loopback/);
  assert.match(script, /\$\{LAUNCHER_URL\}\/api\/status/);
  assert.match(script, /Demo services ready: %s\/api\/status/);
});

function runLauncherWithPort(port) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('bash', [launcherScriptPath], {
      env: { ...process.env, DEMO_LAUNCHER_PORT: port, DEMO_LAUNCHER_OPEN: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('exit', (code) => resolveRun({ code, stdout, stderr }));
  });
}

test('rejects malicious and out-of-range launcher ports before any startup action', async () => {
  const script = await readFile(launcherScriptPath, 'utf8');
  const invalidPorts = [
    '3090@external.example',
    '0',
    '65536',
    '-1',
  ];
  const validationIndex = script.indexOf('DEMO_LAUNCHER_PORT must be a decimal TCP port from 1 to 65535');
  const urlIndex = script.indexOf('LAUNCHER_URL=');

  assert.ok(validationIndex >= 0, 'the wrapper needs a strict TCP port validation error');
  assert.ok(validationIndex < urlIndex, 'the wrapper must validate before constructing a URL');
  for (const port of invalidPorts) {
    const result = await runLauncherWithPort(port);
    assert.equal(result.code, 2, port);
    assert.match(result.stderr, /DEMO_LAUNCHER_PORT must be a decimal TCP port from 1 to 65535/, port);
    assert.equal(result.stdout, '', port);
  }
  assert.match(script, /\[\[ "\$\{LAUNCHER_PORT\}" =~ \^\[0-9\]\+\$ \]\]/);
});
