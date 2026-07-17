'use strict';
/**
 * Layer-3 demo fallback (REPLAY) contracts:
 *  - the golden route serves captured runs, rejects traversal, 404s honestly
 *  - check-goldens fails on STALE/ORPHAN/MALFORMED goldens (a stale golden would
 *    replay fiction with a straight face) and only WARNS on missing ones
 *    (capture needs a healthy live stack; absence must not block pushes)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const useCasesRouter = require('../routes/useCases');
const { checkGoldens, GOLDENS } = require('../../scripts/check-goldens');

const TMP_KEY = 'test-golden-fixture';
const TMP_DIR = path.join(GOLDENS, 'banking');
const TMP_FILE = path.join(TMP_DIR, `${TMP_KEY}.json`);

function makeApp() {
  const app = express();
  app.use('/api/use-cases', useCasesRouter);
  return app;
}

afterEach(() => { try { fs.unlinkSync(TMP_FILE); } catch (_) {} });

describe('GET /api/use-cases/golden/:vertical/:useCaseId', () => {
  test('serves a captured golden', async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({
      vertical: 'banking', useCaseId: TMP_KEY, trigger: 'x',
      capturedAt: '2026-07-17T00:00:00Z', reply: 'Golden reply text',
    }));
    const res = await request(makeApp()).get(`/api/use-cases/golden/banking/${TMP_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Golden reply text');
    expect(res.body.capturedAt).toBeTruthy();
  });

  test('404s honestly when no golden was captured', async () => {
    const res = await request(makeApp()).get('/api/use-cases/golden/banking/never-captured-x');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('golden_not_found');
  });

  test('rejects path traversal in both params', async () => {
    for (const bad of ['..%2F..%2Fstore', 'a..b', '__proto__.']) {
      const res = await request(makeApp()).get(`/api/use-cases/golden/${bad}/x`);
      expect([400, 404]).toContain(res.status);
      expect(res.status === 400 || res.body.error === 'golden_not_found').toBe(true);
    }
  });
});

describe('check-goldens drift rules', () => {
  test('a STALE golden (trigger differs from catalog) fails', () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // Real catalog key with a WRONG trigger — must be flagged stale.
    fs.writeFileSync(path.join(TMP_DIR, 'delegated-access-with-proof.json'), JSON.stringify({
      vertical: 'banking', useCaseId: 'delegated-access-with-proof',
      trigger: 'NOT the real chip text', capturedAt: '2026-07-17T00:00:00Z', reply: 'r',
    }));
    try {
      const { failures } = checkGoldens();
      expect(failures.some((f) => f.includes('[stale] banking/delegated-access-with-proof'))).toBe(true);
    } finally {
      fs.unlinkSync(path.join(TMP_DIR, 'delegated-access-with-proof.json'));
    }
  });

  test('an ORPHAN golden (chip removed from catalog) fails', () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({
      vertical: 'banking', useCaseId: TMP_KEY, trigger: 'x',
      capturedAt: '2026-07-17T00:00:00Z', reply: 'r',
    }));
    const { failures } = checkGoldens();
    expect(failures.some((f) => f.includes(`[orphan] banking/${TMP_KEY}`))).toBe(true);
  });

  test('a MALFORMED golden (missing reply) fails', () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({
      vertical: 'banking', useCaseId: TMP_KEY, trigger: 'x', capturedAt: 'y',
    }));
    const { failures } = checkGoldens();
    expect(failures.some((f) => f.includes('missing "reply"'))).toBe(true);
  });

  test('MISSING goldens only warn — the count is reported, not failed', () => {
    const { failures, missing, total } = checkGoldens();
    // Whatever the current capture coverage, absence itself is never a failure.
    expect(total).toBeGreaterThan(0);
    for (const f of failures) expect(f).not.toContain('[missing]');
    expect(Array.isArray(missing)).toBe(true);
  });
});
