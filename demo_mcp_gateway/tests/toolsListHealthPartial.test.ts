'use strict';

/**
 * tools/list backend outage visibility — PARTIAL counts.
 *
 * The module only recorded a TOTAL outage, and the call site called
 * clearToolsListBackendOutage() for anything less. So one backend stuck in
 * timeout while the others answered reported `toolsListBackendOutage: null` —
 * healthy — while that backend's tools were missing from the catalog. Observed
 * live: `olb` failed 5 tools/list reads in 45 minutes and /health said nothing.
 *
 * A caller then sees a short tool list and reports "tool not found" rather than
 * "backend down", which is the whole failure mode a health endpoint exists to
 * prevent.
 */

import {
  recordToolsListBackendOutage,
  clearToolsListBackendOutage,
  toolsListBackendOutage,
  formatToolsListBackendFailure,
} from '../src/toolsListHealth';

describe('toolsListHealth', () => {
  beforeEach(() => clearToolsListBackendOutage());
  afterAll(() => clearToolsListBackendOutage());

  it('reports a PARTIAL outage when one of several backends fails', () => {
    // The regression: this used to be indistinguishable from healthy.
    recordToolsListBackendOutage(['olb'], 4);

    const outage = toolsListBackendOutage();
    expect(outage).not.toBeNull();
    expect(outage!.scope).toBe('partial');
    expect(outage!.backends).toEqual(['olb']);
    expect(outage!.occurrences).toBe(1);
  });

  it('still reports a TOTAL outage distinctly', () => {
    recordToolsListBackendOutage(['olb', 'invest'], 2);

    expect(toolsListBackendOutage()!.scope).toBe('total');
  });

  it('counts repeat failures of the same episode instead of restarting it', () => {
    recordToolsListBackendOutage(['olb'], 4);
    const since = toolsListBackendOutage()!.since;
    recordToolsListBackendOutage(['olb'], 4);
    recordToolsListBackendOutage(['olb'], 4);

    const outage = toolsListBackendOutage()!;
    expect(outage.occurrences).toBe(3);
    expect(outage.since).toBe(since);
  });

  it('starts a new episode when the outage widens from partial to total', () => {
    recordToolsListBackendOutage(['olb'], 4);
    recordToolsListBackendOutage(['olb', 'invest', 'weather', 'brave'], 4);

    const outage = toolsListBackendOutage()!;
    expect(outage.scope).toBe('total');
    // Not carried over — "since" must describe THIS failure, not the earlier one.
    expect(outage.occurrences).toBe(1);
  });

  it('clears only when every backend answers again', () => {
    recordToolsListBackendOutage(['olb'], 4);
    expect(toolsListBackendOutage()).not.toBeNull();

    // An empty failure list is the all-healthy signal.
    recordToolsListBackendOutage([], 4);
    expect(toolsListBackendOutage()).toBeNull();
  });
});

describe('formatToolsListBackendFailure', () => {
  it('emits a structured diagnostic for a handshake timeout (backend + timeout + elapsed + connect)', () => {
    // Shape of the error proxy.ts attaches on the handshake-timeout path.
    const reason = Object.assign(new Error('MCP handshake timeout'), {
      code: 'handshake_timeout',
      timeoutMs: 10_000,
      elapsedMs: 10_012,
      connectMs: 3,
    });

    const line = formatToolsListBackendFailure('olb', reason);

    // The documented symptom prefix survives so existing greps still hit.
    expect(line).toContain('[GW] tools/list failed for backend=olb');
    expect(line).toContain('reason=handshake_timeout');
    expect(line).toContain('timeoutMs=10000');
    expect(line).toContain('elapsedMs=10012');
    expect(line).toContain('connectMs=3');
    expect(line).toContain('attempts=1');
    // Rules out pool exhaustion by construction — proxy opens a fresh WS each call.
    expect(line).toContain('pool=none(fresh-ws-per-request)');
  });

  it('renders connectMs=n/a when the socket never opened before timing out', () => {
    const reason = Object.assign(new Error('MCP handshake timeout'), {
      code: 'handshake_timeout',
      timeoutMs: 10_000,
      elapsedMs: 10_000,
      connectMs: null,
    });

    expect(formatToolsListBackendFailure('olb', reason)).toContain('connectMs=n/a');
  });

  it('distinguishes a non-timeout failure as reason=other with the raw message', () => {
    const line = formatToolsListBackendFailure(
      'invest',
      new Error('Backend closed connection before responding to tools/list'),
    );

    expect(line).toContain('[GW] tools/list failed for backend=invest');
    expect(line).toContain('reason=other');
    expect(line).not.toContain('handshake_timeout');
    expect(line).toContain('Backend closed connection before responding to tools/list');
  });
});
