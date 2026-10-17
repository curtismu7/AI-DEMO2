'use strict';
// Source guard: bootstrap's A2A step must also grant the CONFIGURED generalist
// (pingone_ai_agent_client_id), not only the app it creates. Regression for the
// 2026-10-13 swap to a native AI_AGENT app that never received the intermediate
// grants (Exchange #1 -> "At least one scope must be granted").
const fs = require('fs');
const path = require('path');

test('A2A provisioning grants the configured actor on each intermediate', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../services/pingoneProvisionService.js'), 'utf8');
  const block = src.slice(src.indexOf('const configuredActorId'));
  expect(block).toMatch(/getEffective\('pingone_ai_agent_client_id'\)/);
  expect(block.slice(0, 900)).toMatch(/grantScopesToApplication\(configuredActorId, specResourceResult\.resource\.id, \[invokeScopeName\]\)/);
});
