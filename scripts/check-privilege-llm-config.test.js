#!/usr/bin/env node
/**
 * Every config key the Privilege LLM proxy reads must appear everywhere a
 * deployment supplies one. Run: node --test scripts/check-privilege-llm-config.test.js
 *
 * node:test rather than jest, matching the other root-level check-*.test.js
 * gates: this file sits at the repo root where CI installs no jest.
 *
 * The bug this pins: PRIVILEGE_LLM_GATEWAY_URL and the virtual keys are read by
 * services/privilegeLlmProxyService.js and were present in NO template, so a
 * fresh clone got empty strings and a runtime failure with no setup step that
 * would have prevented it.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const GATEWAY_KEY = 'PRIVILEGE_LLM_GATEWAY_URL';
const VIRTUAL_KEYS = [
  'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC',
  'PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE',
  'PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI',
];
const KEYS = [GATEWAY_KEY, ...VIRTUAL_KEYS];

const SURFACES = [
  ['k8s secrets template', 'k8s/03-secrets.yaml.template'],
  ['create-secrets.sh', 'k8s/create-secrets.sh'],
  ['.env.example', 'demo_api_server/.env.example'],
  ['docker-compose.yml', 'docker-compose.yml'],
];

describe('Privilege LLM config is reproducible', () => {
  for (const [label, file] of SURFACES) {
    for (const key of KEYS) {
      it(`${label} mentions ${key}`, () => {
        assert.match(read(file), new RegExp(key), `${key} missing from ${file}`);
      });
    }
  }

  // A virtual key is a credential. A populated template would commit one.
  it('the k8s template ships the virtual keys empty', () => {
    const tpl = read('k8s/03-secrets.yaml.template');
    for (const key of VIRTUAL_KEYS) {
      assert.match(
        tpl,
        new RegExp(`^\\s*${key}:\\s*""\\s*$`, 'm'),
        `${key} must be present and empty in the template`,
      );
    }
  });

  // docker-compose.yml carries an explicit warning on the demo-api-server
  // service: `environment:` ALWAYS overrides env_file for the same key, even
  // when the key is absent from the environment today. These values arrive via
  // `env_file: ./demo_api_server/.env`, so listing them under `environment:`
  // with a `${VAR:-}` default would replace a real key with an empty string —
  // the exact shadowing PR #911/#914 and the compose-env-shadow hygiene check
  // exist to prevent. They are documented in compose, never declared there.
  it('compose does not shadow these keys under environment:', () => {
    const compose = read('docker-compose.yml');
    for (const key of KEYS) {
      const declared = new RegExp(`^\\s+${key}\\s*:\\s*["$]`, 'm');
      assert.equal(
        declared.test(compose),
        false,
        `${key} is declared under environment: — that shadows env_file and blanks the real value`,
      );
    }
  });

  // Guards the reverse drift: a key added to the service but to no surface.
  it('the service reads no PRIVILEGE_LLM_* key this test does not cover', () => {
    const svc = read('demo_api_server/services/privilegeLlmProxyService.js');
    const found = [...svc.matchAll(/process\.env\.(PRIVILEGE_LLM_[A-Z0-9_]+)/g)].map((m) => m[1]);
    // PRIVILEGE_LLM_MODEL / _MODEL_<PROVIDER> are optional overrides with
    // defaults in the service, so they need no deployment surface. Note the
    // bare PRIVILEGE_LLM_MODEL has no trailing underscore.
    const isModelOverride = (k) => k === 'PRIVILEGE_LLM_MODEL' || k.startsWith('PRIVILEGE_LLM_MODEL_');
    const uncovered = [...new Set(found)].filter((k) => !KEYS.includes(k) && !isModelOverride(k));
    assert.deepEqual(uncovered, [], `uncovered keys: ${uncovered.join(', ')}`);
  });
});
