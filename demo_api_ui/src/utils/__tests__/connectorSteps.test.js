import { describe, expect, it } from 'vitest';
import { buildConnectorSteps } from '../connectorSteps';

const trace = {
  challenge: { request: { method: 'POST', url: 'https://gw/x/mcp' }, response: { status: 401, wwwAuthenticate: 'Bearer resource_metadata="https://gw/.well-known/oauth-protected-resource"' } },
  resource: { request: { url: 'r' }, response: { status: 200, body: { resource: 'https://gw/x/mcp', scopes_supported: ['mcp:invoke'] } } },
  as: { request: { url: 'a' }, response: { status: 200, body: { code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true } } },
  authorize: { endpoint: 'https://gw/x/authorize', params: { client_id: 'https://app/doc.json' }, clientIdentity: 'cimd' },
  token: { endpoint: 'https://gw/x/token', request: { client_authentication: 'none (public client, PKCE only)' }, response: { expires_in: 3600, scope: 'mcp:invoke' } },
};

const statuses = (steps) => steps.map((s) => s.status);

describe('buildConnectorSteps', () => {
  it('marks nothing done before anything ran', () => {
    const steps = buildConnectorSteps();
    expect(steps).toHaveLength(12);
    expect(statuses(steps).every((s) => s === 'pending')).toBe(true);
  });

  it('marks 1-4 done after the probe and authorize, and leaves 6-12 pending', () => {
    const steps = buildConnectorSteps({ trace: { challenge: trace.challenge, resource: trace.resource, as: trace.as, authorize: trace.authorize } });
    expect(statuses(steps).slice(0, 4)).toEqual(['done', 'done', 'done', 'done']);
    expect(statuses(steps).slice(5)).toEqual(Array(7).fill('pending'));
    expect(steps[2].summary).toContain('CIMD supported');
  });

  it('marks 6-8 done once a token exists, and 9-12 only after a tool call', () => {
    const token = { kind: 'opaque', scope: 'mcp:invoke', value: 't' };
    const signedIn = buildConnectorSteps({ trace, token, signedIn: true });
    expect(statuses(signedIn).slice(5, 8)).toEqual(['done', 'done', 'done']);
    expect(statuses(signedIn).slice(8)).toEqual(Array(4).fill('pending'));
    const permitted = buildConnectorSteps({ trace, token, signedIn: true, call: { ok: true, status: 200, body: { result: 1 } } });
    expect(statuses(permitted).slice(8)).toEqual(Array(4).fill('done'));
    expect(permitted[9].summary).toBe('Permit');
  });

  it('shows a deny at step 10 and does not call downstream', () => {
    const token = { kind: 'opaque', scope: 'mcp:invoke', value: 't' };
    const denied = buildConnectorSteps({ trace, token, signedIn: true, call: { ok: false, status: 403, body: { error: 'no' } } });
    expect(denied[9].status).toBe('error');
    expect(denied[9].summary).toBe('Deny (403)');
    expect(statuses(denied).slice(10)).toEqual(['pending', 'pending']);
  });

  it('shows a refused token at step 9', () => {
    const token = { kind: 'opaque', scope: '', value: 't' };
    const steps = buildConnectorSteps({ trace, token, signedIn: true, call: { ok: false, status: 401, body: {} } });
    expect(steps[8].status).toBe('error');
  });
});
