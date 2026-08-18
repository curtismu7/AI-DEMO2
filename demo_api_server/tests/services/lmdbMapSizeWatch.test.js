'use strict';
// The LMDB mapSize is a hard wall (MDB_MAP_FULL, permanent from the operator's
// view). These tests pin the startup watcher that makes approaching it visible:
// TECH_DEBT 2026-08-18 "The LMDB store is at 66% of a hard 128MB ceiling and
// nothing watches it".

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('lmdb mapSize watcher', () => {
  describe('mapSizeReport (threshold logic)', () => {
    const { mapSizeReport, MAP_SIZE } = require('../../services/lmdb/openEnv');

    test('below 80% is informational', () => {
      const r = mapSizeReport(Math.floor(MAP_SIZE * 0.66));
      expect(r.warn).toBe(false);
      expect(r.message).toContain('of 128MB mapSize (66%)');
    });

    test('at and above 80% warns and says what to do', () => {
      for (const frac of [0.8, 0.95]) {
        const r = mapSizeReport(Math.ceil(MAP_SIZE * frac));
        expect(r.warn).toBe(true);
        expect(r.message).toContain('MDB_MAP_FULL');
        expect(r.message).toContain('before raising mapSize');
      }
    });

    test('respects an explicit mapSize argument', () => {
      expect(mapSizeReport(90, 100).warn).toBe(true);
      expect(mapSizeReport(10, 100).warn).toBe(false);
    });
  });

  describe('openEnv startup log', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmdb-watch-'));
      jest.resetModules();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('logs data.mdb size against mapSize once the env exists', () => {
      const prev = process.env.LMDB_PATH;
      process.env.LMDB_PATH = tmpDir;
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const openEnvModule = require('../../services/lmdb/openEnv');
        // First open creates data.mdb; close and reopen so statSync finds it.
        openEnvModule.openEnv();
        openEnvModule.closeEnv();
        jest.resetModules();
        logSpy.mockClear();
        const reopened = require('../../services/lmdb/openEnv');
        reopened.openEnv();
        reopened.closeEnv();
        const lines = logSpy.mock.calls.map((c) => c[0]);
        expect(lines.some((l) => typeof l === 'string' && l.includes('[lmdb] data.mdb') && l.includes('mapSize'))).toBe(true);
      } finally {
        logSpy.mockRestore();
        if (prev === undefined) delete process.env.LMDB_PATH; else process.env.LMDB_PATH = prev;
        jest.resetModules();
      }
    });
  });
});
