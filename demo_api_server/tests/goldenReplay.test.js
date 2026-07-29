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

/**
 * Drift rules can only be exercised against a REAL catalog key, and checkGoldens()
 * reads the real goldens tree — so these tests must write into it. Deleting the
 * file afterwards destroyed the COMMITTED fixture on every suite run, silently and
 * while passing. Snapshot whatever was there and put it back instead.
 */
function withTempGolden(file, contents, fn) {
  const existed = fs.existsSync(file);
  const prior = existed ? fs.readFileSync(file) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  try {
    return fn();
  } finally {
    if (existed) fs.writeFileSync(file, prior);
    else fs.unlinkSync(file);
  }
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
    // Real catalog key with a WRONG trigger — must be flagged stale.
    const contents = JSON.stringify({
      vertical: 'banking', useCaseId: 'delegated-access-with-proof',
      trigger: 'NOT the real chip text', capturedAt: '2026-07-17T00:00:00Z', reply: 'r',
    });
    withTempGolden(path.join(TMP_DIR, 'delegated-access-with-proof.json'), contents, () => {
      const { failures } = checkGoldens();
      expect(failures.some((f) => f.includes('[stale] banking/delegated-access-with-proof'))).toBe(true);
    });
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

  test('SEED-DRIFT (vertical seed changed since capture) fails', () => {
    // A golden stamped with a different seed hash than the current seed.json
    // would replay outdated VALUES with a straight face — must fail.
    const file = path.join(GOLDENS, 'retail', 'delegated-access-with-proof.json');
    const { resolveUseCase } = require('../config/useCases.js');
    const uc = resolveUseCase('UC1', 'retail');
    const contents = JSON.stringify({
      vertical: 'retail', useCaseId: 'delegated-access-with-proof',
      trigger: uc.trigger.text, expectedOutcome: uc.expectedOutcome || null,
      capturedAt: new Date().toISOString(), reply: 'r', seedHash: 'deadbeefdeadbeef',
    });
    withTempGolden(file, contents, () => {
      const { failures } = checkGoldens();
      expect(failures.some((f) => f.includes('[seed-drift] retail/delegated-access-with-proof'))).toBe(true);
    });
  });

  test('OLD goldens warn (never fail) with their age', () => {
    // Orphan key (fails as orphan) but the AGE path must produce only a warning
    // — verify via a real catalog key with an old timestamp instead.
    const { resolveUseCase } = require('../config/useCases.js');
    const uc = resolveUseCase('UC1', 'banking');
    const file = path.join(TMP_DIR, 'delegated-access-with-proof.json');
    const contents = JSON.stringify({
      vertical: 'banking', useCaseId: 'delegated-access-with-proof',
      trigger: uc.trigger.text, expectedOutcome: uc.expectedOutcome || null,
      capturedAt: '2020-01-01T00:00:00Z', reply: 'r',
    });
    withTempGolden(file, contents, () => {
      const { failures, warnings } = checkGoldens();
      expect(warnings.some((w) => w.includes('[age] banking/delegated-access-with-proof'))).toBe(true);
      expect(failures.some((f) => f.includes('banking/delegated-access-with-proof'))).toBe(false);
    });
  });

  test('MISSING goldens only warn — the count is reported, not failed', () => {
    const { failures, missing, total } = checkGoldens();
    // Whatever the current capture coverage, absence itself is never a failure.
    expect(total).toBeGreaterThan(0);
    for (const f of failures) expect(f).not.toContain('[missing]');
    expect(Array.isArray(missing)).toBe(true);
  });

  // The drift tests above write a REAL catalog key into the REAL goldens tree.
  // They used to delete it afterwards, which destroyed the committed fixture on
  // every suite run — silently, while passing. Guard the restore.
  test('the committed goldens these tests overwrite are left intact', () => {
    for (const vertical of ['banking', 'retail']) {
      const file = path.join(GOLDENS, vertical, 'delegated-access-with-proof.json');
      expect(fs.existsSync(file)).toBe(true);
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Not the throwaway payloads the drift tests write.
      expect(entry.reply).not.toBe('r');
      expect(entry.seedHash).not.toBe('deadbeefdeadbeef');
    }
  });
});
