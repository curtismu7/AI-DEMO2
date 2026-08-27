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

  // Regression guard: a JWT-shaped token (2+ dot segments) whose payload
  // segment fails base64/JSON decode must fail closed, not silently pass
  // through as "non-delegated" — a previously-revoked delegate agent's token
  // could otherwise trip this exact path and bypass the 403 entirely.
  it('fails closed (401) when the token is JWT-shaped but the payload cannot be decoded', () => {
    const req = {
      headers: { authorization: 'Bearer x.not-valid-base64-json!!!.x' },
      user: { id: 'user-1' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    delegationGate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
    expect(delegationStore.findActiveByActorAndGrantor).not.toHaveBeenCalled();
  });
});
