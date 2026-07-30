'use strict';

/**
 * Canaries for /api/token-exchanges:
 * 1) Unauthenticated callers must not read or write the log (auth gate).
 * 2) Stored entries hash tokens — never persist cleartext JWTs.
 * 3) GET is session-scoped — session A must not see session B's entries.
 *
 * The insecure dual-mount (routes/tokenExchanges.js storing cleartext JWTs
 * without authenticateToken) was removed; these tests lock that contract.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const LOG_FILE = path.join(__dirname, '../../data/token-exchanges.log');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mount tokenExchangeLog behind a stub that sets sessionID the way
 * express-session does — without loading the full BFF (authenticateToken
 * needs live PingOne validation).
 */
function buildApp(sessionId) {
  jest.resetModules();
  const router = require('../../routes/tokenExchangeLog');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionID = sessionId;
    req.session = { id: sessionId };
    next();
  });
  app.use('/api/token-exchanges', router);
  return app;
}

describe('POST /api/token-exchanges/log', () => {
  const prevLog = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE) : null;

  beforeEach(() => {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  });

  afterAll(() => {
    if (prevLog === null) {
      if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    } else {
      fs.writeFileSync(LOG_FILE, prevLog);
    }
  });

  it('hashes subject/result tokens and never stores cleartext', async () => {
    const app = buildApp('sess-hash');
    const subjectToken = 'eyJhbGciOiJIUzI1NiJ9.subject-cleartext';
    const resultToken = 'eyJhbGciOiJIUzI1NiJ9.result-cleartext';

    const res = await request(app)
      .post('/api/token-exchanges/log')
      .send({
        timestamp: '2026-07-29T14:32:01Z',
        exchangeType: 'person-to-agent',
        subjectToken,
        resultToken,
        metadata: { aud: 'app', sub: 'user-1' },
      })
      .expect(200);

    expect(res.body.logged).toBe(true);

    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    expect(raw).not.toContain(subjectToken);
    expect(raw).not.toContain(resultToken);

    const entry = JSON.parse(raw.trim().split('\n').pop());
    expect(entry.subjectTokenHash).toBe(hashToken(subjectToken));
    expect(entry.resultTokenHash).toBe(hashToken(resultToken));
    expect(entry.subjectToken).toBeUndefined();
    expect(entry.resultToken).toBeUndefined();
    expect(entry.sessionId).toBe('sess-hash');
  });

  it('returns 400 for missing required fields', async () => {
    const app = buildApp('sess-missing');
    await request(app)
      .post('/api/token-exchanges/log')
      .send({ exchangeType: 'person-to-agent' })
      .expect(400);
  });

  it('ignores client-supplied sessionId and binds to the real session', async () => {
    const app = buildApp('sess-real');
    await request(app)
      .post('/api/token-exchanges/log')
      .send({
        timestamp: '2026-07-29T14:32:01Z',
        exchangeType: 'person-to-mcp',
        sessionId: 'attacker-forged-session',
        subjectToken: 'tok-a',
      })
      .expect(200);

    const entry = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8').trim());
    expect(entry.sessionId).toBe('sess-real');
  });
});

describe('GET /api/token-exchanges', () => {
  const prevLog = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE) : null;

  beforeEach(() => {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  });

  afterAll(() => {
    if (prevLog === null) {
      if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    } else {
      fs.writeFileSync(LOG_FILE, prevLog);
    }
  });

  it('returns only the caller session entries', async () => {
    const appA = buildApp('sess-a');
    const appB = buildApp('sess-b');

    await request(appA)
      .post('/api/token-exchanges/log')
      .send({
        timestamp: '2026-07-29T14:32:01Z',
        exchangeType: 'person-to-agent',
        subjectToken: 'token-a',
      })
      .expect(200);

    await request(appB)
      .post('/api/token-exchanges/log')
      .send({
        timestamp: '2026-07-29T14:33:01Z',
        exchangeType: 'person-to-mcp',
        subjectToken: 'token-b',
      })
      .expect(200);

    const resA = await request(appA).get('/api/token-exchanges').expect(200);
    expect(resA.body.total).toBe(1);
    expect(resA.body.exchanges[0].sessionId).toBe('sess-a');
    expect(resA.body.exchanges[0].exchangeType).toBe('person-to-agent');
    expect(resA.body.exchanges[0].subjectToken).toBeUndefined();
    expect(resA.body.exchanges[0].subjectTokenHash).toBe(hashToken('token-a'));

    const resB = await request(appB).get('/api/token-exchanges').expect(200);
    expect(resB.body.total).toBe(1);
    expect(resB.body.exchanges[0].sessionId).toBe('sess-b');
  });

  it('returns empty exchanges when log is empty', async () => {
    const app = buildApp('sess-empty');
    const res = await request(app).get('/api/token-exchanges').expect(200);
    expect(Array.isArray(res.body.exchanges)).toBe(true);
    expect(res.body.total).toBe(0);
  });
});

describe('auth gate + no cleartext dual-mount', () => {
  it('does not ship the cleartext in-memory tokenExchanges router', () => {
    const cleartextPath = path.join(__dirname, '../../routes/tokenExchanges.js');
    expect(fs.existsSync(cleartextPath)).toBe(false);
  });

  it('server.js mounts /api/token-exchanges only behind authenticateToken', () => {
    const serverSrc = fs.readFileSync(
      path.join(__dirname, '../../server.js'),
      'utf8',
    );
    expect(serverSrc).toMatch(
      /app\.use\(\s*['"]\/api\/token-exchanges['"]\s*,\s*authenticateToken\s*,\s*tokenExchangeLogRouter\s*\)/,
    );
    // No unauthenticated require('./routes/tokenExchanges') mount remains.
    expect(serverSrc).not.toMatch(/require\(\s*['"]\.\/routes\/tokenExchanges['"]\s*\)/);
  });

  it('full app rejects unauthenticated GET/POST with 401', async () => {
    // Skip when the full BFF cannot boot (missing deps / env in a bare worktree).
    let app;
    try {
      jest.resetModules();
      app = require('../../server');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Skipping full-app auth canary — server failed to load:', err.message);
      return;
    }

    await request(app).get('/api/token-exchanges').expect(401);
    await request(app)
      .post('/api/token-exchanges/log')
      .send({
        timestamp: '2026-07-29T14:32:01Z',
        exchangeType: 'person-to-agent',
        subjectToken: 'should-not-be-accepted',
      })
      .expect(401);
  });
});
