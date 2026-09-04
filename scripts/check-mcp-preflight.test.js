#!/usr/bin/env node
/**
 * Tests for the MCP door preflight's pure decision logic.
 * Run: node --test scripts/check-mcp-preflight.test.js
 *
 * node:test rather than jest, matching the other root-level gates: this file
 * sits at the repo root where CI installs no jest.
 *
 * The classification is the part worth pinning. A 401 from the Privilege AI
 * Gateway is a HEALTHY door demanding a token — the gateway 401s before it
 * routes, so even a nonexistent app answers 401. Calling that a failure paints
 * every row red; calling it a full pass would claim an authorization proof this
 * probe cannot make. It is its own state.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classifyProbe, renderTable, exitCodeFor } = require('./lib/preflightRows');

describe('classifyProbe', () => {
  it('treats 200 as ok', () => {
    assert.equal(classifyProbe({ status: 200 }).state, 'ok');
  });

  it('treats 401 as auth, not a failure — the gateway 401s before routing', () => {
    assert.equal(classifyProbe({ status: 401 }).state, 'auth');
  });

  it('treats 403 as down and names a lapsed policy as the likely cause', () => {
    const row = classifyProbe({ status: 403 });
    assert.equal(row.state, 'down');
    assert.match(row.note, /polic/i);
  });

  it('treats 404 as down', () => {
    assert.equal(classifyProbe({ status: 404 }).state, 'down');
  });

  it('treats 502 as down and names a rollout as a possible cause', () => {
    const row = classifyProbe({ status: 502 });
    assert.equal(row.state, 'down');
    assert.match(row.note, /rollout|upstream/i);
  });

  it('treats a network error as unreachable and keeps the message', () => {
    const row = classifyProbe({ error: 'getaddrinfo ENOTFOUND nope.test' });
    assert.equal(row.state, 'unreachable');
    assert.match(row.note, /ENOTFOUND/);
  });

  // A probe that answered nothing at all must not read as a pass.
  it('treats a missing status as down rather than ok', () => {
    assert.equal(classifyProbe().state, 'down');
    assert.equal(classifyProbe({}).state, 'down');
  });

  // An error object, not a string, is what fetch actually rejects with.
  it('keeps the message when the error is an Error, not a string', () => {
    const row = classifyProbe({ error: new Error('socket hang up') });
    assert.equal(row.state, 'unreachable');
    assert.match(row.note, /socket hang up/);
  });
});

describe('exitCodeFor', () => {
  it('passes when every row is ok or auth', () => {
    assert.equal(exitCodeFor([{ state: 'ok' }, { state: 'auth' }]), 0);
  });

  it('fails when any row is down', () => {
    assert.equal(exitCodeFor([{ state: 'ok' }, { state: 'down' }]), 1);
  });

  it('fails when any row is unreachable', () => {
    assert.equal(exitCodeFor([{ state: 'unreachable' }]), 1);
  });

  // `[].every()` is true, so the naive version reports success when the probe
  // produced no rows at all — a config that resolved to zero doors would read
  // as a clean preflight. Nothing probed is not the same as nothing wrong.
  it('fails when there are no rows at all', () => {
    assert.equal(exitCodeFor([]), 1);
  });
});

describe('renderTable', () => {
  it('renders one line per row including the label and the state', () => {
    const out = renderTable([
      { label: 'Direct — banking', url: 'https://a.test/mcp', state: 'ok', note: '' },
      { label: 'Privilege — brave', url: 'https://b.test/mcp', state: 'down', note: 'policy' },
    ]);
    assert.match(out, /Direct — banking/);
    assert.match(out, /Privilege — brave/);
    assert.match(out, /down/);
  });

  it('says so instead of rendering an empty string when there is nothing to show', () => {
    assert.match(renderTable([]), /no doors/i);
  });
});
