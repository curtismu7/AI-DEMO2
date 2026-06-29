'use strict';
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  findActiveByActorAndGrantor: jest.fn(),
}));

const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { delegationGate } = require('../middleware/delegationGate');

function makeReqRes(bearerPayload = {}) {
  const token = 'x.' + Buffer.from(JSON.stringify(bearerPayload)).toString('base64') + '.x';
  const req = {
    headers: { authorization: `Bearer ${token}` },
    user: { id: 'user-1' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('delegationGate', () => {
  it('calls next when active delegation record exists', () => {
    const record = { id: 'del-1', delegator_user_id: 'user-1' };
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(record);
    const { req, res, next } = makeReqRes({ act: { client_id: 'agent-id' } });
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.activeDelegation).toBe(record);
  });

  it('returns 403 when no active delegation record', () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const { req, res, next } = makeReqRes({ act: { client_id: 'agent-id' } });
    delegationGate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'delegation_revoked' })
    );
  });

  it('calls next when token has no act claim (non-delegated request)', () => {
    const { req, res, next } = makeReqRes({});
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(delegationStore.findActiveByActorAndGrantor).not.toHaveBeenCalled();
  });

  it('calls next when authorization header is absent', () => {
    const req = { headers: {}, user: { id: 'u' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
