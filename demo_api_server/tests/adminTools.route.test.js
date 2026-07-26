'use strict';

const { ADMIN_TOOLS } = require('../config/adminTools');

describe('ADMIN_TOOLS data shape', () => {
  test('has 14 entries: 8 banking CRUD + 6 PingOne platform ops', () => {
    expect(ADMIN_TOOLS).toHaveLength(14);
    const adminAgentCount = ADMIN_TOOLS.filter((t) => t.adminAgent === true).length;
    expect(adminAgentCount).toBe(6);
  });

  test('every entry has a unique id, a title, and a chip trigger with text', () => {
    const ids = new Set();
    for (const tool of ADMIN_TOOLS) {
      expect(typeof tool.id).toBe('string');
      expect(ids.has(tool.id)).toBe(false);
      ids.add(tool.id);
      expect(typeof tool.title).toBe('string');
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.trigger).toEqual({ type: 'chip', text: expect.any(String) });
      expect(tool.trigger.text.length).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/admin-tools', () => {
  jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => next(),
    requireAdmin: jest.fn((req, res, next) => {
      if (req.session?.user?.role === 'admin') return next();
      return res.status(403).json({ error: 'admin_required' });
    }),
  }));

  const request = require('supertest');
  const express = require('express');

  function buildApp(role) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { user: { role } };
      next();
    });
    app.use('/api/admin-tools', require('../routes/adminTools'));
    return app;
  }

  test('returns all 14 tools for an admin session', async () => {
    const res = await request(buildApp('admin')).get('/api/admin-tools');
    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(14);
  });

  test('returns 403 for a non-admin session', async () => {
    const res = await request(buildApp('user')).get('/api/admin-tools');
    expect(res.status).toBe(403);
  });
});
