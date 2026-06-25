// demo_api_server/tests/real/shared/admin.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('Admin endpoints (real)', () => {
  let admin, enduser;

  beforeAll(() => {
    skipIfNoSession('admin');
    admin   = createBffClient('admin');
    enduser = createBffClient('enduser');
  });

  describe('GET /api/admin/stats', () => {
    it('returns 200 for admin session', async () => {
      const r = await admin.get('/api/admin/stats');
      expect(r.status).toBe(200);
    });

    it('returns 403 for enduser session', async () => {
      const r = await enduser.get('/api/admin/stats');
      expect(r.status).toBe(403);
    });
  });

  describe('POST /api/admin/reset-demo', () => {
    it('returns 200 and clears demo state', async () => {
      const r = await admin.post('/api/admin/reset-demo');
      expect(r.status).toBe(200);
      expect(r.data.ok).toBe(true);
    });
  });

  describe('GET /api/admin/activity', () => {
    it('returns 200 for admin session', async () => {
      const r = await admin.get('/api/admin/activity');
      expect(r.status).toBe(200);
    });
  });

  describe('GET /api/admin/banking/lookup', () => {
    it('returns user lookup data for admin', async () => {
      const r = await admin.get('/api/admin/banking/lookup?q=chk');
      expect(r.status).toBe(200);
    });
  });

  // Per-vertical Ops back-office lookups (retail, sporting-goods, workforce).
  // Each resolves a demo user and returns that vertical's record slices.
  describe.each(['retail', 'sporting-goods', 'workforce'])('GET /api/admin/%s/lookup', (vertical) => {
    it('returns 200 with a data envelope for admin', async () => {
      const r = await admin.get(`/api/admin/${vertical}/lookup?q=demo`);
      expect(r.status).toBe(200);
      expect(r.data.vertical).toBe(vertical);
      // Either a resolved user with data, or user:null when no demo user matched.
      expect(r.data).toHaveProperty('user');
    });

    it('returns 403 for an enduser session', async () => {
      const r = await enduser.get(`/api/admin/${vertical}/lookup?q=demo`);
      expect(r.status).toBe(403);
    });
  });
});
