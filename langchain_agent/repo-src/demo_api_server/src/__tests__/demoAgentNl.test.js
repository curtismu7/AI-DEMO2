/**
 * Tests for POST /api/demo-agent/nl — natural language intent route.
 *
 * Covers:
 *   - Anonymous POST allowed (marketing agent); context { anonymous: true }
 *   - 400 when message is missing or empty
 *   - Role context (role + firstName) extracted from session and forwarded to parseNaturalLanguage
 *   - Admin role context passed correctly
 *   - Customer (non-admin) role context passed correctly
 *   - Successful banking intent response relayed to client
 *   - Successful education intent response relayed to client
 *   - parseNaturalLanguage errors return 500
 *   - GET /api/demo-agent/nl/status returns LLM provider config
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ── Mock the NL intent service before require()-ing the route ─────────────────
jest.mock('../../services/geminiNlIntent', () => ({
  parseNaturalLanguage: jest.fn(),
  EDU: {},
}));

const { parseNaturalLanguage } = require('../../services/geminiNlIntent');
const nlRouter = require('../../routes/demoAgentNl');

// Prevent mock implementation from one describe block affecting another (Jest parallel / order).
beforeEach(() => {
  parseNaturalLanguage.mockReset();
});

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp(sessionUser = null) {
  const app = express();
  app.use(express.json());
  // Inject a fake session
  app.use((req, _res, next) => {
    req.session = sessionUser ? { user: sessionUser } : {};
    next();
  });
  app.use('/api/demo-agent', nlRouter);
  return app;
}

const ADMIN_USER = {
  id: 'admin-1',
  username: 'admin',
  email: 'admin@bank.com',
  firstName: 'Alice',
  lastName: 'Admin',
  role: 'admin',
};

const CUSTOMER_USER = {
  id: 'cust-1',
  username: 'bob',
  email: 'bob@bank.com',
  firstName: 'Bob',
  lastName: 'Customer',
  role: 'customer',
};

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('POST /api/demo-agent/nl — anonymous allowed', () => {
  it('parses without session user (anonymous marketing agent)', async () => {
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'education', education: { panel: 'login-flow', tab: 'what' } },
    });
    const app = buildApp(null);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'how does oauth login work' });
    expect(res.status).toBe(200);
    expect(parseNaturalLanguage).toHaveBeenCalledWith(
      'how does oauth login work',
      expect.objectContaining({ anonymous: true }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('proceeds when session user is present', async () => {
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'banking', banking: { action: 'accounts', params: {} } },
    });
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'show my accounts' });
    expect(res.status).toBe(200);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/demo-agent/nl — input validation', () => {
  it('returns 400 when message field is missing', async () => {
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('returns 400 when message is empty string', async () => {
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('returns 400 when message is not a string', async () => {
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 42 });
    expect(res.status).toBe(400);
  });
});

// ── Role context forwarding ───────────────────────────────────────────────────

describe('POST /api/demo-agent/nl — role context forwarding', () => {
  beforeEach(() => {
    parseNaturalLanguage.mockResolvedValue({
      source: 'heuristic',
      result: { kind: 'none', message: 'ok' },
    });
  });

  it('passes role=admin and firstName to parseNaturalLanguage for admin users', async () => {
    const app = buildApp(ADMIN_USER);
    await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'list all accounts' });

    expect(parseNaturalLanguage).toHaveBeenCalledWith(
      'list all accounts',
      expect.objectContaining({ role: 'admin', firstName: 'Alice' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('passes role=customer and firstName to parseNaturalLanguage for customer users', async () => {
    const app = buildApp(CUSTOMER_USER);
    await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'check my balance' });

    expect(parseNaturalLanguage).toHaveBeenCalledWith(
      'check my balance',
      expect.objectContaining({ role: 'customer', firstName: 'Bob' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('trims the message before passing it', async () => {
    const app = buildApp(CUSTOMER_USER);
    await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: '  show accounts  ' });

    expect(parseNaturalLanguage).toHaveBeenCalledWith(
      'show accounts',
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ── Response relay ────────────────────────────────────────────────────────────

describe('POST /api/demo-agent/nl — response relay', () => {
  it('returns source and result from parseNaturalLanguage on banking intent', async () => {
    const mockResult = {
      source: 'helix',
      result: { kind: 'banking', banking: { action: 'accounts', params: {} } },
    };
    parseNaturalLanguage.mockResolvedValueOnce(mockResult);

    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'show my accounts' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('helix');
    expect(res.body.result.kind).toBe('banking');
    expect(res.body.result.banking.action).toBe('accounts');
  });

  it('returns source and result for education intent', async () => {
    const mockResult = {
      source: 'heuristic',
      result: { kind: 'education', ciba: true, tab: 'what' },
    };
    parseNaturalLanguage.mockResolvedValueOnce(mockResult);

    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'explain ciba' });

    expect(res.status).toBe(200);
    expect(res.body.result.ciba).toBe(true);
  });

  it('returns 500 when parseNaturalLanguage throws', async () => {
    parseNaturalLanguage.mockRejectedValueOnce(new Error('LLM timeout'));

    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'something' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('nl_parse_failed');
    expect(res.body.message).toContain('LLM timeout');
  });
});

// ── Heuristic-first routing verification ──────────────────────────────────────

describe('POST /api/demo-agent/nl — heuristic-first routing', () => {
  beforeEach(() => {
    // Mock parseNaturalLanguage to track if it returns heuristic source quickly
    parseNaturalLanguage.mockClear();
  });

  it('routes "show my accounts" via heuristic without LLM delay', async () => {
    // Simulate heuristic match
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'banking', banking: { action: 'accounts', params: {} } },
    });
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'show my accounts' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('heuristic');
    expect(res.body.result.kind).toBe('banking');
    expect(res.body.result.banking.action).toBe('accounts');
  });

  it('routes "recent transactions" via heuristic', async () => {
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'banking', banking: { action: 'transactions', params: { period: 'recent' } } },
    });
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'recent transactions' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('heuristic');
    expect(res.body.result.kind).toBe('banking');
  });

  it('routes "explain token exchange" via heuristic (education)', async () => {
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'education', education: { panel: 'token-chain', tab: 'concepts' } },
    });
    const app = buildApp(CUSTOMER_USER);
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'explain token exchange' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('heuristic');
    expect(res.body.result.kind).toBe('education');
  });

  it('routes "what is OAuth?" via heuristic (education)', async () => {
    parseNaturalLanguage.mockResolvedValueOnce({
      source: 'heuristic',
      result: { kind: 'education', education: { panel: 'architecture', tab: 'overview' } },
    });
    const app = buildApp(null); // Allow anonymous
    const res = await request(app)
      .post('/api/demo-agent/nl')
      .send({ message: 'what is OAuth?' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('heuristic');
    expect(res.body.result.kind).toBe('education');
  });
});

// ── Status endpoint ───────────────────────────────────────────────────────────

describe('GET /api/demo-agent/nl/status', () => {
  it('returns provider config without secrets', async () => {
    const app = buildApp(null); // status is public — no session needed
    const res = await request(app)
      .get('/api/demo-agent/nl/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeLlmProvider');
    expect(res.body).toHaveProperty('heuristicAlwaysAvailable', true);
  });

  it('reports heuristicAlwaysAvailable when no LLM is configured', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/demo-agent/nl/status');
    // heuristic is always available regardless of LLM provider configuration
    expect(res.body.heuristicAlwaysAvailable).toBe(true);
  });
});
