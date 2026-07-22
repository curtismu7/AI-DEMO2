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
