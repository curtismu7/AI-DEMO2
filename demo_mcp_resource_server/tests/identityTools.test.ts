'use strict';
import { IDENTITY_TOOLS, dispatchIdentityTool } from '../src/tools/identityTools';
import { ALL_TOOLS, dispatch, findTool } from '../src/tools/registry';
import { filterByScopes } from '../src/tools/toolTypes';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const PF_TOKEN = `${b64u({ alg: 'RS256' })}.${b64u({
  iss: 'https://cmuir-pf.ping-devops.com',
  sub: 'pf-route-c-test',
  aud: 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp',
  client_id: 'pf-route-c-test',
  act: { sub: 'pf-route-c-test' },
  scope: 'openid whoami:read',
  exp: 1800000000,
})}.sig`;

describe('whoami', () => {
  it('is listed only for a token carrying whoami:read', () => {
    expect(IDENTITY_TOOLS[0].requiredScopes).toEqual(['whoami:read']);
    expect(filterByScopes(ALL_TOOLS, ['openid', 'whoami:read']).map((t) => t.name)).toEqual(['whoami']);
    expect(filterByScopes(ALL_TOOLS, ['openid']).map((t) => t.name)).not.toContain('whoami');
    expect(filterByScopes(ALL_TOOLS, []).map((t) => t.name)).not.toContain('whoami');
  });

  it('is registered and dispatched through the registry', async () => {
    expect(findTool('whoami')).toBeDefined();
    const r = (await dispatch('whoami', {}, PF_TOKEN, 'pf-route-c-test')) as Record<string, unknown>;
    expect(r.verifiedBy).toBe('mcp-resource-server');
  });

  it('returns the issuer, subject, actor and audience of the token it received, never the token', async () => {
    const r = (await dispatchIdentityTool('whoami', PF_TOKEN, 'pf-route-c-test')) as Record<string, unknown>;
    expect(r).toMatchObject({
      issuer: 'https://cmuir-pf.ping-devops.com',
      subject: 'pf-route-c-test',
      actor: { sub: 'pf-route-c-test' },
      audience: 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp',
      clientId: 'pf-route-c-test',
      scope: 'openid whoami:read',
      expiresAt: '2027-01-15T08:00:00.000Z',
    });
    expect(r.claims).toMatchObject({ iss: 'https://cmuir-pf.ping-devops.com', act: { sub: 'pf-route-c-test' }, exp: 1800000000 });
    expect(JSON.stringify(r)).not.toContain(PF_TOKEN);
  });

  it('reports nulls for a token without those claims instead of throwing', async () => {
    const r = (await dispatchIdentityTool('whoami', 'not-a-jwt', 'someone')) as Record<string, unknown>;
    expect(r).toMatchObject({ subject: 'someone', issuer: null, actor: null });
  });
});
