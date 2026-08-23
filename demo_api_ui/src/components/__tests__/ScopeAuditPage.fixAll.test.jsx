/**
 * "Fix All Missing" re-fetched and rebuilt the entire PingOne resource+scope
 * audit after each individual scope creation instead of once after the
 * batch, turning one intended batch operation into N sequential full-audit
 * reloads (each itself 1+N requests: one GET for all resources, one per
 * resource for its scopes).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScopeAuditPage from '../ScopeAuditPage';

vi.mock('../CapabilityCallout', () => ({ default: () => null }));

const RESOURCE = {
  id: 'res-1',
  name: 'Test Resource',
  audience: 'test-aud',
  type: 'CUSTOM',
  scopes: [],
  expected: {
    allRequiredPresent: false,
    requiredScopes: ['scope-a', 'scope-b'],
    optionalScopes: [],
    missingRequired: ['scope-a', 'scope-b'],
    missingOptional: [],
  },
};

describe('ScopeAuditPage — Fix All Missing batching', () => {
  let getResourcesCalls;

  beforeEach(() => {
    getResourcesCalls = 0;
    global.fetch = vi.fn((url, opts) => {
      if (String(url).includes('/api/admin/scope-audit/resources')) {
        getResourcesCalls += 1;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ resources: [RESOURCE], environment: 'env-1', region: 'com' }),
        });
      }
      if (String(url).includes('/api/admin/scope-audit/scopes') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('reloads the resource audit once after the batch, not once per scope', async () => {
    render(<ScopeAuditPage />);

    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
    await screen.findByText(/fix all missing/i);
    expect(getResourcesCalls).toBe(1); // initial load

    fireEvent.click(screen.getByRole('button', { name: /fix all missing/i }));

    await waitFor(() => {
      const postCalls = global.fetch.mock.calls.filter(
        ([url, opts]) => String(url).includes('/api/admin/scope-audit/scopes') && opts?.method === 'POST',
      );
      expect(postCalls).toHaveLength(2); // both missing scopes created
    });

    // Exactly one additional GET after the whole batch -- not one per scope.
    await waitFor(() => expect(getResourcesCalls).toBe(2));
    // Give any (incorrect) extra reload a chance to fire before asserting the ceiling.
    await new Promise((r) => setTimeout(r, 20));
    expect(getResourcesCalls).toBe(2);
  });
});
