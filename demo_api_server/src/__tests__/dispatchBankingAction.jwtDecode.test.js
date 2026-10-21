'use strict';

const { dispatchBankingAction } = require('../../services/demoAgentLangGraphService');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(claims)}.sig`;

describe('dispatchBankingAction jwt_decode_demo', () => {
  it('decodes the session token locally, in any vertical', async () => {
    const token = jwt({ iss: 'https://auth.example/as', sub: 'u1', client_id: 'c1', aud: ['a1'], scope: 'read write', exp: 4102444800 });
    const r = await dispatchBankingAction('jwt_decode_demo', {}, 'u1', { vertical: 'banking', userToken: token });
    expect(r.success).toBe(true);
    expect(r.reply).toMatch(/^✅ Success/);
    expect(r.reply).toContain('Issuer: https://auth.example/as');
    expect(r.reply).toContain('Scopes: read write');
    expect(r.reply).not.toContain('.sig');
    expect(r.reply).not.toMatch(/expired/);
  });

  it('flags an expired token', async () => {
    const r = await dispatchBankingAction('jwt_decode_demo', {}, 'u1', { userToken: jwt({ exp: 1 }) });
    expect(r.reply).toMatch(/expired/);
  });

  it('says so when the session token is not a JWT', async () => {
    const r = await dispatchBankingAction('jwt_decode_demo', {}, 'u1', { userToken: '_cookie_session' });
    expect(r.success).toBe(false);
    expect(r.reply).toMatch(/not a JWT/);
  });
});
