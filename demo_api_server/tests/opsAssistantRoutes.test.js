jest.mock('../services/opsAssistantService', () => ({ processOpsMessage: jest.fn() }));
const request = require('supertest');
const express = require('express');
const { processOpsMessage } = require('../services/opsAssistantService');
const opsRoutes = require('../routes/opsAssistantRoutes');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { sub: 'op-1' }; next(); }); // stand-in for authenticateToken
  a.use('/api/admin', opsRoutes);
  return a;
}

describe('POST /api/admin/:vertical/ops-assistant', () => {
  beforeEach(() => jest.clearAllMocks());

  test('400 on empty message', async () => {
    const res = await request(app()).post('/api/admin/healthcare/ops-assistant').send({ query: 'maya' });
    expect(res.status).toBe(400);
  });

  test('200 returns the service envelope', async () => {
    processOpsMessage.mockResolvedValue({ reply: 'ok', success: true, toolsCalled: [], agentConfigured: true });
    const res = await request(app()).post('/api/admin/healthcare/ops-assistant').send({ message: 'hi', query: 'maya' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('ok');
    expect(processOpsMessage).toHaveBeenCalledWith(expect.objectContaining({ vertical: 'healthcare', query: 'maya', message: 'hi' }));
  });

  test('502 when service reports failure', async () => {
    processOpsMessage.mockResolvedValue({ reply: 'down', success: false, error: 'reasoning_unavailable' });
    const res = await request(app()).post('/api/admin/banking/ops-assistant').send({ message: 'hi', query: '0001' });
    expect(res.status).toBe(502);
  });
});
