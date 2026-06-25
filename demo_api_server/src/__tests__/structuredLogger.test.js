// demo_api_server/__tests__/structuredLogger.test.js
const fs = require('fs');
const path = require('path');
const structuredLogger = require('../../services/structuredLogger');

describe('StructuredLogger', () => {
  const testFile = path.join(__dirname, 'temp-test-log.jsonl');

  afterEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it('logs a JSON event with timestamp and requestId', async () => {
    const logger = new (require('../../services/structuredLogger').StructuredLogger)(testFile);

    logger.log({
      requestId: 'test-123',
      event_type: 'user_login_initiated',
      user_agent: 'Mozilla/5.0',
    });

    await logger.close();

    const content = fs.readFileSync(testFile, 'utf-8').trim();
    const parsed = JSON.parse(content);

    expect(parsed.requestId).toBe('test-123');
    expect(parsed.event_type).toBe('user_login_initiated');
    expect(parsed.timestamp).toBeTruthy();
    expect(new Date(parsed.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('appends multiple events on separate lines', async () => {
    const logger = new (require('../../services/structuredLogger').StructuredLogger)(testFile);

    logger.log({ requestId: 'a', event_type: 'event1' });
    logger.log({ requestId: 'a', event_type: 'event2' });
    await logger.close();

    const lines = fs.readFileSync(testFile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).event_type).toBe('event1');
    expect(JSON.parse(lines[1]).event_type).toBe('event2');
  });

  it('handles missing requestId by using "unknown"', async () => {
    const logger = new (require('../../services/structuredLogger').StructuredLogger)(testFile);

    logger.log({ event_type: 'test' }); // no requestId
    await logger.close();

    const content = fs.readFileSync(testFile, 'utf-8').trim();
    const parsed = JSON.parse(content);

    expect(parsed.requestId).toBe('unknown');
  });
});
