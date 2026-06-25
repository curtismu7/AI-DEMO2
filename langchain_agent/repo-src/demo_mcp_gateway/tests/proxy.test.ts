import { buildUpstreamHeaders } from '../src/proxy';

describe('buildUpstreamHeaders', () => {
  it('includes only Authorization when no TraT header', () => {
    const h = buildUpstreamHeaders('token123', undefined);
    expect(h).toEqual({ Authorization: 'Bearer token123' });
  });

  it('includes X-TraT-Context when present', () => {
    const trat = JSON.stringify({ reqctx: { tool: 'get_my_accounts' }, trat_sim: true });
    const h = buildUpstreamHeaders('token123', trat);
    expect(h['X-TraT-Context']).toBe(trat);
    expect(h['Authorization']).toBe('Bearer token123');
  });
});
