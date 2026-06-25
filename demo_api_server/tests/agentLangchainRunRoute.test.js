const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => {
    req.session = { oauthTokens: { accessToken: 'tok_user' }, id: 'sess_test' };
    next();
  },
}));
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn().mockResolvedValue({
    token: 'tok_mcp',
    tokenEvents: [],
    userSub: 'user_123',
  }),
}));
jest.mock('../services/aguiSseProxy', () => ({
  buildTokenChainEvents: jest.fn().mockReturnValue([]),
  proxyAgentSse: jest.fn(({ browserRes, runId, sessionId }) => {
    browserRes.write(`data: {"type":"RUN_STARTED","runId":"${runId}","threadId":"${sessionId}"}\n\n`);
    browserRes.write(`data: {"type":"RUN_FINISHED","runId":"${runId}","threadId":"${sessionId}"}\n\n`);
    browserRes.end();
  }),
}));

const agentLangchainRunRoute = require('../routes/agentLangchainRunRoute');

const app = express();
app.use(express.json());
app.use('/api/agent/langchain', agentLangchainRunRoute);

describe('POST /api/agent/langchain/run', () => {
  test('returns SSE stream with RUN_STARTED and RUN_FINISHED', async () => {
    const res = await request(app)
      .post('/api/agent/langchain/run')
      .send({ message: 'hello', session_id: 'sess_1' })
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('RUN_STARTED');
    expect(res.body).toContain('RUN_FINISHED');
  });

  test('returns 400 if message is missing', async () => {
    const res = await request(app)
      .post('/api/agent/langchain/run')
      .send({ session_id: 'sess_1' });
    expect(res.status).toBe(400);
  });
});
