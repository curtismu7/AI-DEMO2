#!/usr/bin/env node
/**
 * The external door's 401 must carry a WWW-Authenticate a strict client can parse.
 *
 * external-door-401-metadata.groovy appends the RFC 9728 resource_metadata hint to
 * whatever challenge the upstream returned. That upstream answers with a param-less
 * `Bearer`, so appending ", resource_metadata=..." unconditionally produced
 *
 *     WWW-Authenticate: Bearer , resource_metadata="https://.../.well-known/..."
 *
 * whose first auth-param is EMPTY. RFC 7235 puts commas BETWEEN auth-params, never
 * between the scheme and the first one, so a strict parser rejects the header
 * outright — the client never extracts the hint, never fetches the metadata, and
 * never starts OAuth. Measured 2026-09-07: LM Studio's MCP bridge failed with
 * "authentication required" on this door, while the doors emitting
 * `Bearer resource_metadata="..."` or `Bearer scope="x", resource_metadata="..."`
 * completed discovery against the same client.
 *
 * Run: node --test ping-gateway/scripts/check-www-authenticate-shape.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const GROOVY = path.join(__dirname, 'groovy', 'external-door-401-metadata.groovy');

/**
 * Minimal RFC 7235 challenge check: `scheme` optionally followed by a
 * comma-separated list of `name=value` auth-params. An empty element anywhere in
 * that list (what a stray leading comma produces) is a parse failure.
 */
function parseChallenge(value) {
  const m = /^([A-Za-z][A-Za-z0-9!#$%&'*+\-.^_`|~]*)(?:\s+(.*))?$/.exec(value.trim());
  if (!m) return { ok: false, reason: 'no scheme' };
  const rest = (m[2] || '').trim();
  if (!rest) return { ok: true, scheme: m[1], params: {} };
  const params = {};
  for (const part of rest.split(',')) {
    const p = part.trim();
    if (!p) return { ok: false, reason: 'empty auth-param' };
    const eq = p.indexOf('=');
    if (eq <= 0) return { ok: false, reason: `not a name=value pair: "${p}"` };
    params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { ok: true, scheme: m[1], params };
}

test('a stray comma after a param-less scheme is a parse failure', () => {
  const bad = parseChallenge('Bearer , resource_metadata="https://x/.well-known/oauth-protected-resource"');
  assert.strictEqual(bad.ok, false, 'this is the shape that broke LM Studio — it must not be treated as valid');
  assert.strictEqual(bad.reason, 'empty auth-param');
});

test('both shapes the fixed script can emit are parseable and expose resource_metadata', () => {
  for (const value of [
    // upstream sent a bare `Bearer` -> space separator
    'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"',
    // upstream already had params -> comma separator
    'Bearer scope="mcp:invoke", resource_metadata="https://x/.well-known/oauth-protected-resource"',
    'Bearer realm="Demo MCP Server", error="unauthorized", resource_metadata="https://x/.well-known/oauth-protected-resource"',
  ]) {
    const got = parseChallenge(value);
    assert.ok(got.ok, `should parse: ${value} (${got.reason})`);
    assert.match(got.params.resource_metadata || '', /^https?:\/\/.+\/\.well-known\/oauth-protected-resource$/);
  }
});

test('the groovy picks its separator instead of always emitting a comma', () => {
  const src = fs.readFileSync(GROOVY, 'utf8');
  // The regression is a one-character edit away, and nothing else in this repo
  // executes this file — an unconditional comma must not come back.
  assert.doesNotMatch(
    src,
    /existing\s*\+\s*',\s*resource_metadata/,
    'external-door-401-metadata.groovy concatenates a comma unconditionally again — that emits "Bearer , resource_metadata=..." when the upstream challenge has no auth-params',
  );
  assert.match(src, /contains\('='\)/, 'the separator must still be chosen from whether an auth-param is present');
});
