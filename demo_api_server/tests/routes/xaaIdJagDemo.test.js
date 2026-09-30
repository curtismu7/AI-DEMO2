'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../routes/pfDavinciAuth', () => ({ exchangeIdJag: jest.fn() }));
const { exchangeIdJag } = require('../../routes/pfDavinciAuth');
const router = require('../../routes/xaaIdJagDemo');

const app = express();
app.use('/api/demo/xaa', router);

const body = {
  subject_token: 'client-supplied',
  requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
  audience: 'domain-b-as',
};

describe('POST /api/demo/xaa/id-jag', () => {
  beforeEach(() => exchangeIdJag.mockReset());

  it('returns the real PingFederate ID-JAG when the session has a PF sign-in', async () => {
    exchangeIdJag.mockResolvedValue({ access_token: 'pf.id.jag', token_type: 'N_A' });
    const res = await request(app).post('/api/demo/xaa/id-jag').send(body);
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('pf.id.jag');
    expect(exchangeIdJag).toHaveBeenCalledWith(expect.anything(), { audience: 'domain-b-as', resource: undefined, scope: undefined });
  });

  it('falls back to the mock when there is no PF sign-in', async () => {
    exchangeIdJag.mockResolvedValue(null);
    const res = await request(app).post('/api/demo/xaa/id-jag').send(body);
    expect(res.status).toBe(200);
    expect(res.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(res.body.access_token).not.toBe('pf.id.jag');
  });

  it('502s with only an error code when PF refuses or is unreachable', async () => {
    exchangeIdJag.mockResolvedValueOnce({ error: 'invalid_grant' });
    let res = await request(app).post('/api/demo/xaa/id-jag').send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'invalid_grant' });
    exchangeIdJag.mockRejectedValueOnce(new Error('connect ECONNREFUSED pf.internal:9031'));
    res = await request(app).post('/api/demo/xaa/id-jag').send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'id_jag_exchange_failed' });
  });
});
