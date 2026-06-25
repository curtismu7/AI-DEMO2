'use strict';

const { runWithCorrelation, getCorrelationId } = require('../../../utils/correlationContext');
const { createTeachLogger } = require('../../../utils/teachLogger');
const { buildSsePayload } = require('../../../services/sseCorrelation');
const { Writable } = require('stream');

describe('correlation end-to-end (BFF in-process)', () => {
  it('one id appears on log lines AND the SSE payload within one request scope', async () => {
    const lines = [];
    const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
    const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
    let ssePayload;
    await runWithCorrelation('e2e-id', async () => {
      log.step(4, 9, 'RFC 8693 exchange REQUEST', { access_token: 'eyJ.a.b' });
      log.info('exchange done');
      ssePayload = buildSsePayload('token-event', { kind: 'exchange' });
    });
    const stepLine = lines.find((l) => l.msg && l.msg.includes('RFC 8693'));
    expect(stepLine.correlation_id).toBe('e2e-id');
    expect(stepLine.access_token).toBe('eyJ.a.b'); // still visible — teaching, not redacted
    expect(lines.find((l) => l.msg === 'exchange done').correlation_id).toBe('e2e-id');
    expect(ssePayload.correlation_id).toBe('e2e-id');
    expect(getCorrelationId()).toBeUndefined(); // scope cleaned up after
  });
});
