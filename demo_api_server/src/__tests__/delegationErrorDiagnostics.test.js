const delegationErrorMiddleware = require('../../middleware/delegationErrorMiddleware');
const {
  buildDelegationClaimMissing,
  describeActChainShape,
} = require('../../services/errorMessageBuilder');

function encodeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${header}.${body}.x`;
}

describe('delegation error diagnostics', () => {
  it('explains nested RFC 8693 act chains in missing-claim guidance', () => {
    const details = buildDelegationClaimMissing({ endpoint: '/api/mcp/tool', method: 'POST' });

    expect(details.what_failed).toContain('/api/mcp/tool');
    expect(details.teaching).toContain('act.act.sub');
    expect(details.fix).toContain('1-exchange');
    expect(details.fix).toContain('2-exchange');
    expect(details.tokens_involved.expected_claim_shape).toContain('act.sub');
    expect(describeActChainShape()).toContain('act.act.sub');
  });

  it('accepts allowed actors found in a nested act chain', () => {
    const middleware = delegationErrorMiddleware({
      allowedActors: ['agent-client-123'],
    });
    const req = {
      headers: {
        authorization: `Bearer ${encodeJwt({
          sub: 'user-1',
          act: {
            sub: 'mcp-client-456',
            act: {
              sub: 'agent-client-123',
            },
          },
        })}`,
      },
      session: {},
      method: 'POST',
      originalUrl: '/api/mcp/tool',
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});