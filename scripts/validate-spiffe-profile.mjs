#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = [
  'spiffe/docker-compose/spire-server.conf',
  'spiffe/docker-compose/spire-agent.conf',
  'spiffe/docker-compose/helper-bff.conf',
  'spiffe/docker-compose/oidc-discovery-provider.conf',
  'spiffe/docker-compose/entries.sh',
];

const failures = [];
for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) failures.push(`missing ${relative}`);
}

const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
for (const service of ['spire-server:', 'spire-agent:', 'spire-registration:', 'spiffe-helper-bff:', 'spiffe-oidc-provider:']) {
  if (!compose.includes(service)) failures.push(`compose is missing ${service}`);
}
if (!/profiles:\s*\["spiffe"\]/.test(compose)) failures.push('SPIFFE services are not profile-gated');
if (!compose.includes('FF_SPIFFE_CLIENT_AUTH')) failures.push('BFF SPIFFE client-auth flag is not wired');

const entries = fs.readFileSync(path.join(root, 'spiffe/docker-compose/entries.sh'), 'utf8');
for (const id of ['spiffe://bxfinance.demo/bff', 'spiffe://bxfinance.demo/agent', 'spiffe://bxfinance.demo/mcp-gateway', 'spiffe://bxfinance.demo/mcp-server']) {
  if (!entries.includes(id)) failures.push(`registration entry is missing ${id}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`✓ SPIFFE profile validated (${requiredFiles.length} config files, 5 compose services, 4 workload entries)`);
}
