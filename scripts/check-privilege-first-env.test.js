#!/usr/bin/env node
/**
 * The sidecar agents (openai / pydantic / mastra) and LibreChat take their LLM
 * endpoint from two env knobs so PingOne Privilege can be the first hop without
 * a code change. Run: node --test scripts/check-privilege-first-env.test.js
 *
 * The bug this pins: a hardcoded AGENT_LLM_BASE_URL on any one of them means
 * that agent silently keeps calling the local proxy while the flag says
 * "Privilege first".
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('Privilege-first LLM posture is env-driven', () => {
  it('every sidecar AGENT_LLM_BASE_URL in docker-compose.yml is env-driven, with a key beside it', () => {
    const lines = read('docker-compose.yml').split('\n');
    const hits = lines.map((l, i) => [l, i]).filter(([l]) => /^\s+AGENT_LLM_BASE_URL:/.test(l));
    // openai-agent, pydantic-agent, mastra-agent. The BFF must NOT carry one:
    // its env_file supplies its env and the compose-env-shadow hygiene rule
    // rejects an environment: entry beside it.
    assert.equal(hits.length, 3, `expected exactly the three sidecar agents, found ${hits.length}`);
    for (const [l, i] of hits) {
      assert.match(l, /\$\{AGENT_LLM_BASE_URL:-http:\/\/host\.docker\.internal:8090\/v1\}/, `line ${i + 1} is not env-driven`);
      const window = lines.slice(i, i + 8).join('\n');
      assert.match(window, /AGENT_LLM_API_KEY: "\$\{AGENT_LLM_API_KEY:-none\}"/, `no key near line ${i + 1}`);
    }
  });

  it('LibreChat reads the same two knobs', () => {
    const yaml = read('librechat/librechat.yaml');
    assert.match(yaml, /baseURL: '\$\{AGENT_LLM_BASE_URL\}'/);
    assert.match(yaml, /apiKey: '\$\{AGENT_LLM_API_KEY\}'/);
    const compose = read('librechat/docker-compose.yml');
    assert.match(compose, /AGENT_LLM_BASE_URL: "\$\{AGENT_LLM_BASE_URL:-http:\/\/host\.docker\.internal:8090\/v1\}"/);
    assert.match(compose, /AGENT_LLM_API_KEY: "\$\{AGENT_LLM_API_KEY:-none\}"/);
  });

  it('the reason service documents the Privilege lane env it reads', () => {
    const env = read('demo_agent_service/.env.example');
    for (const key of ['PRIVILEGE_LLM_GATEWAY_URL', 'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC', 'PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE']) {
      assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from demo_agent_service/.env.example`);
    }
  });
});
