// demo_api_server/tests/stepVerificationLedger.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { writeLedgerEntry, readLedger, ROOT } = require('../services/stepVerificationLedger');

describe('stepVerificationLedger', () => {
  const vertical = 'banking';
  const testFile = path.join(ROOT, vertical, 'UC-TEST.chip.heuristic.json');

  afterEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  test('throws when a required field is missing', () => {
    expect(() => writeLedgerEntry({ vertical, useCaseId: 'UC-TEST' })).toThrow(/missing required field/);
  });

  test('writes a well-formed entry to the expected deterministic path', () => {
    const written = writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(written).toBe(testFile);
    const saved = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(saved.status).toBe('PASS');
  });

  test('re-recording the same verdict later the same day leaves the file byte-identical', () => {
    const base = {
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
    };
    writeLedgerEntry({ ...base, checkedAt: '2026-07-22T00:00:00.000Z' });
    const first = fs.readFileSync(testFile, 'utf8');
    writeLedgerEntry({ ...base, checkedAt: '2026-07-22T18:42:11.913Z' });
    expect(fs.readFileSync(testFile, 'utf8')).toBe(first);
  });

  // A later-day re-run used to rewrite every ledger file with only the date
  // changed (measured: 537-file diff from one suite run; in the main checkout
  // that churn also blocks sync-main-checkout.sh). Unchanged verdicts now skip
  // the write until the stored date ages past REFRESH_AGE_DAYS (15) — half the
  // warn-only staleness threshold, so a re-verifying row can never go stale.
  describe('unchanged verdicts do not churn the tree on later-day re-runs', () => {
    const base = {
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
    };
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

    test('same verdict, stored date still fresh — write skipped, old date kept', () => {
      writeLedgerEntry({ ...base, checkedAt: daysAgo(3) });
      const before = fs.readFileSync(testFile, 'utf8');
      writeLedgerEntry({ ...base, checkedAt: daysAgo(0) });
      expect(fs.readFileSync(testFile, 'utf8')).toBe(before);
      expect(JSON.parse(before).checkedAt).toBe(daysAgo(3).slice(0, 10));
    });

    test('same verdict but stored date near staleness — date refreshed', () => {
      writeLedgerEntry({ ...base, checkedAt: daysAgo(20) });
      writeLedgerEntry({ ...base, checkedAt: daysAgo(0) });
      expect(JSON.parse(fs.readFileSync(testFile, 'utf8')).checkedAt).toBe(daysAgo(0).slice(0, 10));
    });

    test('changed verdict — rewritten immediately even with a fresh stored date', () => {
      writeLedgerEntry({ ...base, checkedAt: daysAgo(1) });
      writeLedgerEntry({ ...base, status: 'FAIL', errorClass: 'wrong_gate', checkedAt: daysAgo(0) });
      const saved = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      expect(saved.status).toBe('FAIL');
      expect(saved.checkedAt).toBe(daysAgo(0).slice(0, 10));
    });

    test('caller field order alone is not a change', () => {
      writeLedgerEntry({ ...base, checkedAt: daysAgo(2) });
      const before = fs.readFileSync(testFile, 'utf8');
      // Same fields, different construction order.
      writeLedgerEntry({
        primaryTool: 'create_transfer',
        errorClass: null,
        status: 'PASS',
        mode: 'heuristic',
        triggerType: 'chip',
        useCaseId: 'UC-TEST',
        vertical,
        checkedAt: daysAgo(0),
      });
      expect(fs.readFileSync(testFile, 'utf8')).toBe(before);
    });
  });

  test('checkedAt is stored day-granular and stays Date.parse-able for the staleness gate', () => {
    writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T18:42:11.913Z',
    });
    const saved = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(saved.checkedAt).toBe('2026-07-22');
    expect(Number.isFinite(Date.parse(saved.checkedAt))).toBe(true);
  });

  test('rejects a status outside the vocabulary', () => {
    expect(() =>
      writeLedgerEntry({
        vertical,
        useCaseId: 'UC-TEST',
        triggerType: 'chip',
        mode: 'heuristic',
        status: 'OK',
        errorClass: null,
        primaryTool: 'create_transfer',
        checkedAt: '2026-07-22T00:00:00.000Z',
      }),
    ).toThrow(/unknown status "OK"/);
  });

  describe('a self-declared PASS that proves nothing is downgraded to UNPROVEN', () => {
    const base = {
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    };
    const saved = () => JSON.parse(fs.readFileSync(testFile, 'utf8'));

    test.each([
      ['provesDeclaredOnly', { provesDeclaredOnly: true }],
      ['flagsAssumedOn', { flagsAssumedOn: true }],
      ['flagsOffDetected', { flagsOffDetected: ['ff_mcp_gateway_pinggateway'] }],
    ])('%s marks the entry UNPROVEN, not PASS', (_label, marker) => {
      writeLedgerEntry({ ...base, status: 'PASS', ...marker });
      expect(saved().status).toBe('UNPROVEN');
    });

    test('an unmarked PASS stays PASS', () => {
      writeLedgerEntry({ ...base, status: 'PASS', flagsOffDetected: [] });
      expect(saved().status).toBe('PASS');
    });

    test('FAIL is never downgraded — a defect found under stubbed flags is still a defect', () => {
      writeLedgerEntry({
        ...base,
        status: 'FAIL',
        errorClass: 'missing_prereq',
        provesDeclaredOnly: true,
        flagsAssumedOn: true,
        flagsOffDetected: ['ff_mcp_gateway_pinggateway'],
      });
      expect(saved().status).toBe('FAIL');
      expect(saved().errorClass).toBe('missing_prereq');
    });
  });

  test('records a FAIL verdict to disk so the gate can see it', () => {
    writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'FAIL',
      errorClass: 'wrong_response',
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    });
    const { checkStepVerification } = require('../../scripts/check-step-verification.js');
    // UC-TEST is not a catalog id, so the gate also reports it as an orphan.
    // This test is about the FAIL verdict only.
    const hit = checkStepVerification().failures.filter(
      (f) => f.startsWith('[fail]') && f.includes('UC-TEST.chip.heuristic.json'),
    );
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatch(/status FAIL errorClass=wrong_response/);
  });

  describe('the gate and the report separate declared from proven', () => {
    const base = {
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    };
    const gate = () => require('../../scripts/check-step-verification.js').checkStepVerification();
    const row = () => `${vertical}/UC-TEST.chip.heuristic.json`;

    test('an UNPROVEN entry is counted, but does not fail the gate', () => {
      writeLedgerEntry({ ...base, status: 'PASS', provesDeclaredOnly: true });
      const { failures, unproven } = gate();
      expect(failures.filter((f) => f.startsWith('[fail]') && f.includes(row()))).toEqual([]);
      expect(unproven).toBeGreaterThan(0);
    });

    test('a status outside the vocabulary is reported malformed', () => {
      fs.writeFileSync(testFile, JSON.stringify({ ...base, status: 'OK' }), 'utf8');
      expect(gate().failures).toContainEqual(
        expect.stringContaining(`[malformed] ${row()}: unknown status "OK"`),
      );
    });

    // Asserted against the report's own rows rather than by diffing two builds:
    // other suites write the same ledger directory concurrently, so any count
    // taken at two different moments is a race.
    test('the report does not count an UNPROVEN row as proven', () => {
      const { buildReport } = require('../../scripts/gen-step-verification-report.js');
      writeLedgerEntry({ ...base, status: 'PASS', provesDeclaredOnly: true });
      const report = buildReport();

      expect(report).toContain(`| ${vertical} | UC-TEST | chip | heuristic | ⚠️ UNPROVEN |`);

      // Data rows of the main table: 7 cells, and not the header.
      const rows = report
        .split('\n')
        .filter((l) => l.startsWith('| ') && l.split('|').length === 9)
        .filter((l) => !l.includes('| Vertical |') && !l.startsWith('|---'));
      const claimed = Number(/^(\d+)\/\d+ checks proven/m.exec(report)[1]);
      expect(claimed).toBe(rows.filter((l) => l.includes('✅ PASS')).length);
      expect(claimed).toBeLessThan(rows.length);
    });
  });

  test('readLedger returns every entry written for a vertical', () => {
    writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    });
    const entries = readLedger(vertical);
    expect(entries.some((e) => e.useCaseId === 'UC-TEST')).toBe(true);
  });
});
