'use strict';

jest.mock('axios');
const axios = require('axios');

const forwarder = require('../services/lokiForwarder');

const OLD_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: {} });
  process.env.LOKI_URL = 'http://loki.test:3100';
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('lokiForwarder', () => {
  // Same defect class newRelicForwarder and sailpointForwarder guard against:
  // LOKI_URL could live in demo_api_server/.env, which jest loads, so without
  // this guard every `npm test` run would ship fixture events into a real Loki.
  it('does not POST while running under jest', async () => {
    expect(process.env.JEST_WORKER_ID || process.env.NODE_ENV).toBeTruthy();
    await forwarder.forwardAppEvent({ category: 'pingone', message: 'x' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('still no-ops when the override is set but LOKI_URL is unset', async () => {
    process.env.LOKI_ALLOW_TEST_FORWARD = 'true';
    delete process.env.LOKI_URL;
    await forwarder.forwardAppEvent({ category: 'pingone', message: 'x' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('posts to the Loki push path with nanosecond string timestamps', async () => {
    process.env.LOKI_ALLOW_TEST_FORWARD = 'true';
    const ts = '2026-09-05T12:00:00.000Z';
    await forwarder.forwardAppEvent({
      category: 'pingone', severity: 'warn', message: 'hello', timestamp: ts,
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe('http://loki.test:3100/loki/api/v1/push');
    const [tsNs, line] = payload.streams[0].values[0];
    // A JSON number loses precision past 2^53 and Loki rejects the entry, so
    // this MUST stay a string of nanoseconds.
    expect(typeof tsNs).toBe('string');
    expect(tsNs).toBe(`${new Date(ts).getTime() * 1e6}`);
    expect(JSON.parse(line).message).toBe('hello');
  });

  it('keeps labels low-cardinality and puts per-event ids in the line only', async () => {
    process.env.LOKI_ALLOW_TEST_FORWARD = 'true';
    await forwarder.forwardAppEvent({
      category: 'auth', severity: 'error', message: 'm',
      correlationId: 'c-1', username: 'demouser', eventId: 'e-1',
    });
    const [, payload] = axios.post.mock.calls[0];
    const labels = payload.streams[0].stream;
    // One stream per label-value combination: an id in a label is one stream
    // per event, which degrades Loki until queries time out.
    expect(Object.keys(labels).sort()).toEqual(
      ['category', 'logtype', 'service', 'severity']
    );
    expect(JSON.parse(payload.streams[0].values[0][1]).correlationId).toBe('c-1');
  });

  it('defaults category and severity rather than emitting undefined labels', async () => {
    process.env.LOKI_ALLOW_TEST_FORWARD = 'true';
    await forwarder.forwardAppEvent({ message: 'no category' });
    const labels = axios.post.mock.calls[0][1].streams[0].stream;
    expect(labels.category).toBe('unknown');
    expect(labels.severity).toBe('info');
  });

  it('never throws when Loki is unreachable', async () => {
    process.env.LOKI_ALLOW_TEST_FORWARD = 'true';
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      forwarder.forwardAppEvent({ category: 'auth', message: 'm' })
    ).resolves.toBeUndefined();
  });
});
