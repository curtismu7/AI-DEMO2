#!/usr/bin/env node
/**
 * check-codegraph-sse-nginx.js — guardrail for Code Explorer SSE proxy config.
 *
 * Regression (2026-07-15): frontend nginx buffered /api/codegraph until the LLM
 * finished (~60s+), so browsers reported a network/timeout error. All three
 * nginx surfaces (local Dockerfile, k8s base configmap, AWS override) must keep
 * a dedicated /api/codegraph/ location with proxy_buffering off and long
 * read/send timeouts, and they must stay in sync.
 *
 *   node scripts/check-codegraph-sse-nginx.js
 *   npm run hygiene:check
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const fails = [];
const fail = (msg) => fails.push(msg);

const FILES = [
  'demo_api_ui/nginx.conf',
  'k8s/02-configmap.yaml',
  'k8s/aws/nginx-http-configmap.yaml',
];

const REQUIRED = [
  { re: /location\s+\/api\/codegraph\//, tip: 'add location /api/codegraph/ before location /api/' },
  { re: /proxy_buffering\s+off\s*;/, tip: 'set proxy_buffering off; inside /api/codegraph/' },
  { re: /proxy_read_timeout\s+300s\s*;/, tip: 'set proxy_read_timeout 300s;' },
  { re: /proxy_send_timeout\s+300s\s*;/, tip: 'set proxy_send_timeout 300s;' },
];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`${rel}: missing — Code Explorer SSE hardening requires this file`);
    continue;
  }
  const txt = fs.readFileSync(abs, 'utf8');
  // Isolate the codegraph location block so /api/ defaults cannot satisfy the check.
  const blockMatch = txt.match(/location\s+\/api\/codegraph\/\s*\{[\s\S]*?\n\s*\}/);
  if (!blockMatch) {
    fail(`${rel}: missing location /api/codegraph/ { … } block`);
    continue;
  }
  const block = blockMatch[0];
  for (const { re, tip } of REQUIRED) {
    if (re === REQUIRED[0].re) continue; // already matched via block extract
    if (!re.test(block)) {
      fail(`${rel}: /api/codegraph/ block missing ${re} — ${tip}`);
    }
  }
}

const ingress = path.join(ROOT, 'k8s/aws/se-ingress.yaml');
if (fs.existsSync(ingress)) {
  const txt = fs.readFileSync(ingress, 'utf8');
  if (!/nginx\.ingress\.kubernetes\.io\/proxy-buffering:\s*"off"/.test(txt)) {
    fail('k8s/aws/se-ingress.yaml: missing nginx.ingress.kubernetes.io/proxy-buffering: "off"');
  }
  if (!/nginx\.ingress\.kubernetes\.io\/proxy-read-timeout:\s*"300"/.test(txt)) {
    fail('k8s/aws/se-ingress.yaml: missing nginx.ingress.kubernetes.io/proxy-read-timeout: "300"');
  }
}

if (fails.length) {
  console.error('✗ Code Explorer SSE nginx hygiene FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error('\nSee REGRESSION_PLAN.md — Code Explorer SSE buffering (2026-07-15).');
  process.exit(1);
}
console.log('✓ Code Explorer SSE nginx: buffering off + 300s timeouts on all proxy surfaces');
