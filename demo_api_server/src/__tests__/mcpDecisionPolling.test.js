/**
 * @file mcpDecisionPolling.test.js
 * HITL decision polling routes — now a thin ADAPTER over the canonical HITL
 * service (3009). These tests mock hitlServiceClient and assert the routes
 * proxy correctly (GET/approve/deny), preserve auth + owner checks, and map
 * the 3009 record shape to the legacy UI response shape. taskId === 3009
 * challengeId.
 */

'use strict';

jest.mock('../../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(),
  getChallengeStatus: jest.fn(),
  respondToChallenge: jest.fn(),
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const hitlServiceClient = require('../../services/hitlServiceClient');
const mcpDecisionPollingRouter = require('../../routes/mcpDecisionPolling');
const { createPendingDecision } = require('../../routes/mcpDecisionPolling');

function createApp(sessionUser = null) {
  const app = express();
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    if (sessionUser) req.session.user = sessionUser;
    next();
  });
  app.use('/api/mcp', mcpDecisionPollingRouter);
  return app;
}

const USER_A = { oauthId: 'user-aaa', id: 'user-aaa', role: 'user' };
const USER_B = { oauthId: 'user-bbb', id: 'user-bbb', role: 'user' };

// A 3009 challenge record (the shape getChallengeStatus returns).
function challenge(over = {}) {
  return {
    challengeId: 'ch-1',
    status: 'pending',
    userId: USER_A.oauthId,
    tool: 'create_transfer',
    context: { reason: 'High-value transfer', decisionId: 'dec-1' },
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T00:10:00Z',
    resolvedAt: null,
    ...over,
  };
}

// resetAllMocks (not clearAllMocks) so a mockRejectedValue/mockResolvedValue
// set in one test does NOT leak its implementation into the next.
afterEach(() => jest.resetAllMocks());

describe('createPendingDecision() — adapter over 3009', () => {
  it('creates a challenge in 3009 and returns taskId === challengeId', async () => {
    hitlServiceClient.createChallenge.mockResolvedValue({ challengeId: 'ch-xyz', status: 'pending' });
    const { taskId } = await createPendingDecision('user-123', {
      tool: 'create_transfer', decisionId: 'dec-1', reason: 'High-value transfer',
    });
    expect(taskId).toBe('ch-xyz');
    expect(hitlServiceClient.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'create_transfer',
        userId: 'user-123',
        context: expect.objectContaining({ decisionId: 'dec-1', reason: 'High-value transfer' }),
      }),
    );
  });
});

describe('HITL Decision Polling — HTTP routes (proxy to 3009)', () => {
  // ── Authentication ───────────────────────────────────────
  it('GET /decision/:taskId returns 401 without session', async () => {
    const res = await request(createApp(null)).get('/api/mcp/decision/ch-1');
    expect(res.status).toBe(401);
  });
  it('POST /approve returns 401 without session', async () => {
    const res = await request(createApp(null)).post('/api/mcp/decision/ch-1/approve');
    expect(res.status).toBe(401);
  });
  it('POST /deny returns 401 without session', async () => {
    const res = await request(createApp(null)).post('/api/mcp/decision/ch-1/deny');
    expect(res.status).toBe(401);
  });

  // ── GET /decision/:taskId ────────────────────────────────
  describe('GET /decision/:taskId', () => {
    it('returns 200 with pending status for own decision', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
      const res = await request(createApp(USER_A)).get('/api/mcp/decision/ch-1');
      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe('ch-1');
      expect(res.body.status).toBe('pending');
      expect(res.body.tool).toBe('create_transfer');
      expect(res.body.reason).toBe('High-value transfer');
    });

    it('returns 404 for nonexistent taskId', async () => {
      hitlServiceClient.getChallengeStatus.mockRejectedValue(new Error('failed (404)'));
      const res = await request(createApp(USER_A)).get('/api/mcp/decision/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('returns 403 when another user tries to poll', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ userId: USER_A.oauthId }));
      const res = await request(createApp(USER_B)).get('/api/mcp/decision/ch-1');
      expect(res.status).toBe(403);
    });
  });

  // ── POST /approve ────────────────────────────────────────
  describe('POST /decision/:taskId/approve', () => {
    it('approves a pending decision (proxies respondToChallenge)', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
      hitlServiceClient.respondToChallenge.mockResolvedValue({ challengeId: 'ch-1', status: 'approved', decision: 'approved' });
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/ch-1/approve');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.taskId).toBe('ch-1');
      // 3rd arg is req.correlationId (undefined in this test harness) — assert
      // only the meaningful args; expect.anything() would reject undefined.
      expect(hitlServiceClient.respondToChallenge).toHaveBeenCalledWith('ch-1', 'approved', undefined);
    });

    it('returns 404 for nonexistent taskId', async () => {
      hitlServiceClient.getChallengeStatus.mockRejectedValue(new Error('failed (404)'));
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/nope/approve');
      expect(res.status).toBe(404);
      expect(hitlServiceClient.respondToChallenge).not.toHaveBeenCalled();
    });

    it('returns 403 for wrong user', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ userId: USER_A.oauthId }));
      const res = await request(createApp(USER_B)).post('/api/mcp/decision/ch-1/approve');
      expect(res.status).toBe(403);
      expect(hitlServiceClient.respondToChallenge).not.toHaveBeenCalled();
    });

    it('returns 409 when already resolved', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ status: 'approved' }));
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/ch-1/approve');
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('already_resolved');
      expect(hitlServiceClient.respondToChallenge).not.toHaveBeenCalled();
    });

    it('returns 502 when the HITL service errors on respond', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
      hitlServiceClient.respondToChallenge.mockRejectedValue(new Error('3009 down'));
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/ch-1/approve');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('hitl_service_error');
    });
  });

  // ── POST /deny ───────────────────────────────────────────
  describe('POST /decision/:taskId/deny', () => {
    it('denies a pending decision', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge());
      hitlServiceClient.respondToChallenge.mockResolvedValue({ challengeId: 'ch-1', status: 'denied', decision: 'denied' });
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/ch-1/deny');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('denied');
      expect(hitlServiceClient.respondToChallenge).toHaveBeenCalledWith('ch-1', 'denied', undefined);
    });

    it('returns 403 for wrong user', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ userId: USER_A.oauthId }));
      const res = await request(createApp(USER_B)).post('/api/mcp/decision/ch-1/deny');
      expect(res.status).toBe(403);
    });

    it('returns 409 when already resolved', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue(challenge({ status: 'denied' }));
      const res = await request(createApp(USER_A)).post('/api/mcp/decision/ch-1/deny');
      expect(res.status).toBe(409);
    });
  });
});
