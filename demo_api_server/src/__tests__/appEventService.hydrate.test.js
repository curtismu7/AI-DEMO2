// demo_api_server/src/__tests__/appEventService.hydrate.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('appEventService hydrateFromFile', () => {
  let tmpFile;
  let svc;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `activity-hydrate-${Date.now()}-${Math.random().toString(16).slice(2)}.ndjson`,
    );
    process.env.ACTIVITY_LOG_FILE = tmpFile;
    jest.resetModules();
    svc = require('../../services/appEventService');
    svc.clearEvents();
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) { /* ignore */ }
    delete process.env.ACTIVITY_LOG_FILE;
  });

  it('restores events from NDJSON into getEvents after clear', () => {
    const rows = [
      {
        id: 'h1',
        timestamp: '2026-07-15T10:00:00.000Z',
        category: 'oauth',
        severity: 'info',
        message: 'login',
      },
      {
        id: 'h2',
        timestamp: '2026-07-15T10:01:00.000Z',
        category: 'mcp',
        severity: 'info',
        message: 'tool',
      },
    ];
    fs.writeFileSync(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const loaded = svc.hydrateFromFile();
    expect(loaded).toBe(2);

    const events = svc.getEvents({ limit: 10 });
    expect(events.map((e) => e.id)).toEqual(['h2', 'h1']);
  });

  it('writes new events under ACTIVITY_LOG_FILE (LOG_DIRECTORY-compatible path)', () => {
    svc.logEvent('agent', 'info', 'ping', { tag: 'test/hydrate' });
    const raw = fs.readFileSync(tmpFile, 'utf8');
    expect(raw).toContain('"message":"ping"');
    expect(svc._logFilePath).toBe(path.resolve(tmpFile));
  });
});
