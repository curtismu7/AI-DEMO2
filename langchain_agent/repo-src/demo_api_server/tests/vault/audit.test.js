'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordAudit } = require('../../lib/vault/audit');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-audit-'));
}

describe('vault/audit: recordAudit', () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = tmpdir();
    filePath = path.join(dir, 'audit.log');
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('appends one line ending in \\n containing all 7 fields', () => {
    recordAudit(filePath, {
      op: 'read',
      key: 'X',
      result: 'ok',
      caller: 'vault.js',
    });
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(Object.keys(obj).sort()).toEqual(
      ['caller', 'host', 'key', 'op', 'pid', 'result', 'ts'].sort(),
    );
    expect(obj.op).toBe('read');
    expect(obj.key).toBe('X');
    expect(obj.result).toBe('ok');
    expect(obj.caller).toBe('vault.js');
    expect(obj.pid).toBe(process.pid);
    expect(obj.host).toBe(os.hostname());
    expect(typeof obj.ts).toBe('string');
  });

  test('throws when entry contains an unexpected field like "value"', () => {
    expect(() =>
      recordAudit(filePath, {
        op: 'read',
        key: 'X',
        result: 'ok',
        caller: 'vault.js',
        value: 'super-secret', // unexpected
      }),
    ).toThrow(/recordAudit: unexpected field value/);
  });

  test('50 sequential calls produce 50 lines, each parsable JSON, none interleaved', () => {
    for (let i = 0; i < 50; i++) {
      recordAudit(filePath, {
        op: 'read',
        key: 'K' + i,
        result: 'ok',
        caller: 'vault.js',
      });
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(50);
    for (let i = 0; i < 50; i++) {
      const obj = JSON.parse(lines[i]);
      expect(obj.key).toBe('K' + i);
    }
  });

  test('grep test: a sentinel value never appears in inputs → 0 hits; when passed as key → 1 hit', () => {
    const SENTINEL = 'XXX-VALUE-XXX';
    for (let i = 0; i < 100; i++) {
      recordAudit(filePath, {
        op: 'read',
        key: 'KEY_' + i,
        result: 'ok',
        caller: 'vault.js',
      });
    }
    let raw = fs.readFileSync(filePath, 'utf8');
    expect(raw.includes(SENTINEL)).toBe(false);

    // Now pass the sentinel as `key` — allowed channel. Expect exactly 1 hit.
    recordAudit(filePath, {
      op: 'read',
      key: SENTINEL,
      result: 'ok',
      caller: 'vault.js',
    });
    raw = fs.readFileSync(filePath, 'utf8');
    const hits = raw.split(SENTINEL).length - 1;
    expect(hits).toBe(1);
  });

  test('write failure (read-only dir) does NOT propagate; console.warn only', () => {
    // Point at a path inside a missing directory so appendFileSync throws.
    const bogus = path.join(dir, 'nonexistent-subdir', 'audit.log');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        recordAudit(bogus, {
          op: 'open',
          key: null,
          result: 'ok',
          caller: 'vault.js',
        }),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        '[vault.audit] write failed:',
        expect.any(String),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('throws on non-object entry', () => {
    expect(() => recordAudit(filePath, null)).toThrow();
    expect(() => recordAudit(filePath, 'string')).toThrow();
  });
});
