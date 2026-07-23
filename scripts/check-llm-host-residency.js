#!/usr/bin/env node
// scripts/check-llm-host-residency.js
'use strict';

/**
 * Static hygiene: catch the post-startup LLM failure mode where
 * (1) host llama-server binds 127.0.0.1 so Docker ECONNREFUSED, and/or
 * (2) host tier-manager starts without LLM_PROXY_RESIDENT_TIERS so a gpt-oss
 *     swap kills the BFF's phi tier → reasoning_unavailable / broken chat.
 *
 * Never starts models — file-content assertions only.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  const errors = [];

  const startLocal = read('demo_llm_proxy/start-local-models.sh');
  if (!/LLAMA_LISTEN_HOST="\$\{LLAMA_ARG_HOST:-0\.0\.0\.0\}"/.test(startLocal)) {
    errors.push(
      'start-local-models.sh must default LLAMA_LISTEN_HOST to 0.0.0.0 '
        + '(Docker cannot reach 127.0.0.1-bound tiers via host.docker.internal)',
    );
  }
  if (!/--host "\$LLAMA_LISTEN_HOST"/.test(startLocal)) {
    errors.push('start-local-models.sh must pass --host "$LLAMA_LISTEN_HOST" to llama-server');
  }

  const runDocker = read('run-docker.sh');
  if (!/_restart_tier_manager/.test(runDocker)) {
    errors.push('run-docker.sh must define _restart_tier_manager with residency env');
  }
  if (!/LLM_PROXY_RESIDENT_TIERS="\$\{_LLM_RESIDENT_TIERS\}"/.test(runDocker)) {
    errors.push(
      'run-docker.sh must export LLM_PROXY_RESIDENT_TIERS onto the host tier-manager process',
    );
  }
  if (!/ensure-set "\$\{_LLM_RESIDENT_TIERS\}"/.test(runDocker)) {
    errors.push(
      'run-docker.sh must call ensure-set for resident tiers (not only ensure-available)',
    );
  }
  if (!/up -d --no-deps llm-proxy/.test(runDocker)) {
    errors.push(
      'run-docker.sh must recreate llm-proxy after oMLX/mlx fallback to llama.cpp',
    );
  }

  const tierManager = read('demo_llm_proxy/tier-manager.js');
  if (!/require\('\.\/ensureArgs'\)/.test(tierManager)) {
    errors.push('tier-manager.js must use ./ensureArgs (resolveEnsureArgs) for residency swaps');
  }

  const ensureArgs = read('demo_llm_proxy/ensureArgs.js');
  if (!/function resolveEnsureArgs/.test(ensureArgs)) {
    errors.push('demo_llm_proxy/ensureArgs.js must export resolveEnsureArgs');
  }

  if (errors.length) {
    for (const e of errors) console.error('[llm-host-residency] FAIL —', e);
    return 1;
  }

  console.log(
    '[llm-host-residency] OK — host bind 0.0.0.0 + tier-manager residency wiring present',
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
