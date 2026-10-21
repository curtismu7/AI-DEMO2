import { describe, expect, it } from 'vitest';
import { buildConnectorSteps } from '../connectorSteps';

const leg = (extra = {}) => ({ at: 't', ...extra });
const early = {
  '1a': leg(), '1b': leg({ response: { status: 401, body: {} } }),
  '2a': leg(), '2b': leg({ response: { body: { resource: 'https://x/mcp', scopes_supported: ['benefits:read'] } } }),
  '3a': leg(), '3b': leg({ response: { body: { code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['private_key_jwt'] } } }),
  '4a': leg(), '4b': leg(),
};
const consented = {
  ...early,
  '5a': leg(), '5b': leg({ response: { status: 200, body: { client_name: 'ChatGPT', token_endpoint_auth_method: 'private_key_jwt' } } }),
  '6a': leg(), '6b': leg(), '6c': leg(), '6d': leg(),
};
const tokened = {
  ...consented,
  '7a': leg(), '8a': leg(), '8b': leg(), '8c': leg({ response: { status: 200, body: {} } }),
};
const statuses = (steps) => steps.map((s) => s.status);

describe('buildConnectorSteps', () => {
  it('marks nothing done before a run exists', () => {
    const steps = buildConnectorSteps();
    expect(steps).toHaveLength(12);
    expect(statuses(steps).every((s) => s === 'pending')).toBe(true);
  });

  it('marks steps done only when every leg they name was recorded', () => {
    const steps = buildConnectorSteps({ run: { status: 'started', trace: early } });
    expect(statuses(steps)).toEqual(['done', 'done', 'done', 'done', ...Array(8).fill('pending')]);
    expect(steps[2].summary).toContain('CIMD supported');
  });

  it('keeps step 6 pending while the member has not decided, and records the consent outcome', () => {
    const waiting = buildConnectorSteps({ run: { status: 'started', trace: { ...early, '5a': leg(), '5b': leg({ response: { status: 200, body: {} } }), '6a': leg() } } });
    expect(waiting[5].status).toBe('pending');
    expect(waiting[5].summary).toContain('waiting');
    const done = buildConnectorSteps({ run: { status: 'code_received', consent: { consentId: 'cns_1', version: 1 }, trace: consented } });
    expect(done[5].status).toBe('done');
    expect(done[5].summary).toContain('cns_1');
  });

  it('shows denied consent as stopped at step 6', () => {
    const steps = buildConnectorSteps({ run: { status: 'denied', trace: { ...consented } } });
    expect(steps[5].status).toBe('error');
    expect(steps[5].summary).toContain('denied');
  });

  it('completes 7-12 after a permitted call', () => {
    const trace = {
      ...tokened,
      '9a': leg(), '10a': leg(), '10b': leg({ response: { decision: 'PERMIT' } }),
      '11a': leg(), '11b': leg(), '12a': leg({ response: { status: 200, body: {} } }), '12b': leg({ text: 'ok' }),
    };
    const steps = buildConnectorSteps({ run: { status: 'complete', trace } });
    expect(statuses(steps).every((s) => s === 'done')).toBe(true);
    expect(steps[9].summary).toBe('PERMIT');
  });

  it('shows a policy DENY as stopped at step 10, with the downstream call never made', () => {
    const trace = { ...tokened, '9a': leg(), '10a': leg(), '10b': leg({ response: { decision: 'DENY' } }), '12a': leg({ response: { status: 403, body: {} } }) };
    const steps = buildConnectorSteps({ run: { status: 'refused', trace } });
    expect(steps[8].status).toBe('done');
    expect(steps[9].status).toBe('error');
    expect(steps[10].status).toBe('pending');
    expect(steps[11].status).toBe('error');
  });

  it('shows a rejected token as stopped at step 9', () => {
    const trace = { ...tokened, '9a': leg(), '12a': leg({ response: { status: 401, body: { error_description: 'Token rejected: audience' } } }) };
    const steps = buildConnectorSteps({ run: { status: 'refused', trace } });
    expect(steps[8].status).toBe('error');
    expect(steps[8].summary).toContain('audience');
  });
});
