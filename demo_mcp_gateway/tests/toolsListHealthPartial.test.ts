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
