'use strict';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';

const ENV_KEYS = [
  'BROKER_API_KEY',
  'PINGONE_TOKEN_ENDPOINT',
  'PINGONE_AGENT_CLIENT_ID',
  'PINGONE_AGENT_CLIENT_SECRET',
  'TARGETS_JSON',
  'TOPOLOGY_PATH',
];
const saved: Record<string, string | undefined> = {};
let dir: string;

// The exact value docker-compose.yml gives the sidecar; keep the two in step.
const COMPOSE_TARGETS = '{"agent-gateway":{"topologyResource":"Super Banking Agent Gateway"}}';

function topologyFile(resources: unknown): string {
  const file = path.join(dir, 'scope-topology.json');
  writeFileSync(file, JSON.stringify({ resources }));
  return file;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.BROKER_API_KEY = 'k';
  process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env/as/token';
  process.env.PINGONE_AGENT_CLIENT_ID = 'client';
  process.env.PINGONE_AGENT_CLIENT_SECRET = 'secret';
  delete process.env.TOPOLOGY_PATH;
  dir = mkdtempSync(path.join(tmpdir(), 'ats-topo-'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

test('a topologyResource target takes its scope and resource from the topology', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ 'Agent GW': { uri: 'gw.example', scopes: ['a:one', 'a:two'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Agent GW' } });
  expect(loadConfig().targets.gw).toEqual({ scope: 'a:one a:two', resource: 'gw.example' });
});

test('anything set explicitly on the target wins over the topology', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ 'Agent GW': { uri: 'gw.example', scopes: ['a:one'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Agent GW', scope: 'narrower' } });
  expect(loadConfig().targets.gw).toEqual({ scope: 'narrower', resource: 'gw.example' });
});

test('the resolved target does not carry topologyResource', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ 'Agent GW': { uri: 'gw.example', scopes: ['a:one'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Agent GW' } });
  expect('topologyResource' in loadConfig().targets.gw).toBe(false);
});

test('targets without topologyResource behave exactly as before and never read the file', () => {
  process.env.TOPOLOGY_PATH = path.join(dir, 'does-not-exist.json');
  process.env.TARGETS_JSON = JSON.stringify({ gw: { scope: 'ai_agent', resource: 'mcpgateway.ping.demo' } });
  expect(loadConfig().targets.gw).toEqual({ scope: 'ai_agent', resource: 'mcpgateway.ping.demo' });
});

test('a resource that is not in the topology fails at startup, naming it', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ 'Agent GW': { uri: 'gw.example', scopes: ['a:one'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Nope' } });
  expect(() => loadConfig()).toThrow(/"Nope" is not a resource in the topology/);
});

test('inherited object keys are not resources', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ 'Agent GW': { uri: 'gw.example', scopes: ['a:one'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'constructor' } });
  expect(() => loadConfig()).toThrow(/is not a resource in the topology/);
});

test('a resource with no scopes or no uri fails at startup', () => {
  process.env.TOPOLOGY_PATH = topologyFile({ Empty: { uri: 'gw.example', scopes: [] }, NoUri: { scopes: ['a'] } });
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Empty' } });
  expect(() => loadConfig()).toThrow(/has no uri or scopes/);
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'NoUri' } });
  expect(() => loadConfig()).toThrow(/has no uri or scopes/);
});

test('an unreadable topology file fails at startup instead of serving a half-configured target', () => {
  process.env.TOPOLOGY_PATH = path.join(dir, 'missing.json');
  process.env.TARGETS_JSON = JSON.stringify({ gw: { topologyResource: 'Agent GW' } });
  expect(() => loadConfig()).toThrow(/cannot be read as JSON/);
});

test('the real scope-topology.json resolves the compose target to the Agent Gateway actor scope', () => {
  process.env.TOPOLOGY_PATH = path.join(__dirname, '../../scope-topology.json');
  process.env.TARGETS_JSON = COMPOSE_TARGETS;
  expect(loadConfig().targets['agent-gateway']).toEqual({
    scope: 'agent:invoke',
    resource: 'agentgateway.ping.demo',
  });
});
