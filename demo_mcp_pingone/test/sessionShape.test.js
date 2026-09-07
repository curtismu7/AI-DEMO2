'use strict';

// The bridge mints the worker token itself and writes the session file the
// upstream binary reads, because the Linux v0.0.2 build ignores
// PINGONE_AUTH_GRANT_TYPE=client_credentials (the darwin build of the same
// commit honours it). That means we depend on an UNDOCUMENTED on-disk format.
//
// This test pins that format against a real sample captured from the upstream
// binary on 2026-09-07. If a future release changes the shape, this goes red —
// which is the whole point: the alternative is a demo that silently stops
// authenticating with no clue why.

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Captured verbatim (token elided) from ~/.pingone_mcp_session.json after a
// successful client_credentials run of pingone-mcp-server v0.0.2.
const UPSTREAM_SAMPLE = {
  accessToken: 'eyJhbGciOi...elided...',
  refreshToken: '',
  expiry: '2026-09-07T17:10:19.066002-05:00',
  sessionId: '55b7cf53-8a2b-47f3-9bc4-130b298e0954',
};

function loadFresh(sessionFile) {
  // The module reads SESSION_FILE at require time, so each case needs a fresh
  // module registry rather than a shared import.
  delete require.cache[require.resolve('../server')];
  process.env.PINGONE_MCP_SESSION_FILE = sessionFile;
  return require('../server');
}

test('the file we write matches the shape upstream writes', () => {
  const f = path.join(os.tmpdir(), `shape-${process.pid}-a.json`);
  fs.writeFileSync(f, JSON.stringify({
    accessToken: 'x',
    refreshToken: '',
    expiry: new Date(Date.now() + 3600_000).toISOString(),
    sessionId: '00000000-0000-0000-0000-000000000002',
  }));
  const written = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(
    Object.keys(written).sort(),
    Object.keys(UPSTREAM_SAMPLE).sort(),
    'session file keys drifted from what pingone-mcp-server v0.0.2 writes',
  );
  // client_credentials never issues a refresh token — expiry is handled by
  // re-minting, so an empty string here is correct, not an oversight.
  assert.equal(written.refreshToken, '');
  assert.ok(!Number.isNaN(Date.parse(written.expiry)), 'expiry must parse as a date');
  fs.unlinkSync(f);
});

test('a session expiring inside the skew window is treated as stale', () => {
  const f = path.join(os.tmpdir(), `shape-${process.pid}-b.json`);
  // 2 minutes left — inside the 5-minute skew, so it must be re-minted BEFORE
  // a call goes out rather than failing mid-demo.
  fs.writeFileSync(f, JSON.stringify({
    accessToken: 'x', refreshToken: '', expiry: new Date(Date.now() + 120_000).toISOString(), sessionId: 'x',
  }));
  const { sessionIsFresh } = loadFresh(f);
  assert.equal(sessionIsFresh(), false);
  fs.unlinkSync(f);
});

test('a comfortably valid session is reused rather than re-minted', () => {
  const f = path.join(os.tmpdir(), `shape-${process.pid}-c.json`);
  fs.writeFileSync(f, JSON.stringify({
    accessToken: 'x', refreshToken: '', expiry: new Date(Date.now() + 3600_000).toISOString(), sessionId: 'x',
  }));
  const { sessionIsFresh } = loadFresh(f);
  assert.equal(sessionIsFresh(), true);
  fs.unlinkSync(f);
});

test('a missing or malformed session file is stale, never a crash', () => {
  const missing = path.join(os.tmpdir(), `shape-${process.pid}-none.json`);
  assert.equal(loadFresh(missing).sessionIsFresh(), false);

  const bad = path.join(os.tmpdir(), `shape-${process.pid}-bad.json`);
  fs.writeFileSync(bad, 'not json at all');
  assert.equal(loadFresh(bad).sessionIsFresh(), false);
  fs.unlinkSync(bad);
});

test('the upstream auth-failure message is recognised, so the retry can fire', () => {
  const { isAuthFailure } = loadFresh(path.join(os.tmpdir(), `shape-${process.pid}-d.json`));
  // Verbatim from the sidecar logs, 2026-09-07.
  assert.equal(isAuthFailure({
    result: { content: [{ text: 'pingone-mcp-server list_applications tool failed: no active auth session found and a browser can\'t be used for login. Unable to authenticate' }], isError: true },
  }), true);
  assert.equal(isAuthFailure({
    result: { content: [{ text: 'failed to login: oauth2: "invalid_client" "Request denied: Invalid client credentials"' }], isError: true },
  }), true);
  assert.equal(isAuthFailure({ result: { tools: [{ name: 'list_applications' }] } }), false);
});
