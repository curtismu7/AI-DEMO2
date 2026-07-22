'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/cibaService', () => ({
  initiateBackchannelAuth: jest.fn(),
  pollForTokens: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isSimulatedApproved: jest.fn(),
  SIMULATED_APPROVE_DELAY_MS: 7000,
}));

jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/delegationService', () => ({
  findActiveByDelegate: jest.fn(),
  requestApproval: jest.fn(),
  getApprovalStatus: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    req.user = JSON.parse(h);
    next();
  },
}));

const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const delegationService = require('../../services/delegationService');
// Top-level, not lazy: setup.js's global afterEach calls jest.resetModules(),
// and routes/ciba.js captures trackTokenEvent via a top-level require at load
// time (before any test runs). A require() inside a later test body would
// resolve to a fresh module instance post-reset — a different jest.fn()
// than the one the router actually calls — so this must match the router's
// own require timing.
const { trackTokenEvent } = require('../../services/tokenChainService');
const cibaRouter = require('../../routes/ciba');

const EMPLOYEE_HDR = JSON.stringify({ id: 'dana-1', email: 'dana@example.com' });
const AUTH_REQ_ID = 'sim-manager-approval-req';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use('/api/auth/ciba', cibaRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  cibaService.isEnabled.mockReturnValue(true);
  cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED')); // always simulated in this suite
  cibaSimulatedService.initiateSimulated.mockReturnValue({ auth_req_id: AUTH_REQ_ID, expires_in: 300, interval: 5 });
});

describe('POST /api/auth/ciba/initiate — manager-approval branch', () => {
  test('tags the session record with delegationId and calls requestApproval when an active manager delegation exists', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue({ id: 'deleg-1', delegator_user_id: 'sam-1' });
    delegationService.requestApproval.mockResolvedValue({ ok: true });

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve $600 expense', amount: 600, tool: 'submit_expense' });

    expect(res.status).toBe(200);
    expect(delegationService.findActiveByDelegate).toHaveBeenCalledWith('dana-1');
    expect(delegationService.requestApproval).toHaveBeenCalledWith('deleg-1', expect.objectContaining({
      authReqId: AUTH_REQ_ID, amount: 600, tool: 'submit_expense',
    }));
  });

  test('does not call requestApproval when the employee has no active manager delegation (unchanged behavior)', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue(null);

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer' });

    expect(res.status).toBe(200);
    expect(delegationService.requestApproval).not.toHaveBeenCalled();
  });

  test('a lookup failure does not break initiate (falls through to self-approval)', async () => {
    delegationService.findActiveByDelegate.mockRejectedValue(new Error('db unavailable'));

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer' });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/ciba/poll/:authReqId — manager-approval branch', () => {
  async function initiateWithDelegation() {
    delegationService.findActiveByDelegate.mockResolvedValue({ id: 'deleg-1', delegator_user_id: 'sam-1' });
    delegationService.requestApproval.mockResolvedValue({ ok: true });
    const agent = request.agent(buildApp());
    await agent.set('x-test-user', EMPLOYEE_HDR).post('/api/auth/ciba/initiate').send({ amount: 600 });
    return agent;
  }

  test('stays pending while the delegation record is still pending', async () => {
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'pending', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(cibaSimulatedService.isSimulatedApproved).not.toHaveBeenCalled();
  });

  test('resolves approved once the manager approves, tracking approvedBy', async () => {
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'approved', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(trackTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalData: expect.objectContaining({ approvedBy: 'sam-1' }),
      }),
    );
  });

  test('returns 403 denied when the manager denies', async () => {
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'denied', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
  });

  test('falls through to the plain simulated timer when there is no delegationId (unchanged behavior)', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue(null);
    const agent = request.agent(buildApp());
    await agent.set('x-test-user', EMPLOYEE_HDR).post('/api/auth/ciba/initiate').send({});

    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);
    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(delegationService.getApprovalStatus).not.toHaveBeenCalled();
  });
});
