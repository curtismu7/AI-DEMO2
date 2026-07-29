const request = require('supertest');
const app = require('../../server');

describe('POST /api/token-exchanges/log', () => {
  it('logs exchange with valid payload', async () => {
    const payload = {
      timestamp: '2026-07-29T14:32:01Z',
      exchangeType: 'person-to-agent',
      subjectToken: 'subject123',
      resultToken: 'result456',
      metadata: { aud: 'app', sub: 'user-1' }
    };

    const res = await request(app)
      .post('/api/token-exchanges/log')
      .send(payload)
      .expect(200);

    expect(res.body.logged).toBe(true);
  });

  it('returns 400 for missing required fields', async () => {
    const payload = {
      exchangeType: 'person-to-agent'
      // missing timestamp, sessionId
    };

    await request(app)
      .post('/api/token-exchanges/log')
      .send(payload)
      .expect(400);
  });
});

describe('GET /api/token-exchanges', () => {
  it('returns paginated exchanges', async () => {
    const res = await request(app)
      .get('/api/token-exchanges?limit=10&offset=0')
      .expect(200);

    expect(res.body).toHaveProperty('exchanges');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
  });

  it('returns empty exchanges when log is empty', async () => {
    const res = await request(app)
      .get('/api/token-exchanges')
      .expect(200);

    expect(Array.isArray(res.body.exchanges)).toBe(true);
  });
});
