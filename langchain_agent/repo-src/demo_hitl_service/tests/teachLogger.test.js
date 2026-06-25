const { Writable } = require('stream');
const { createTeachLogger } = require('../src/teachLogger');

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _e, cb) { lines.push(JSON.parse(chunk.toString())); cb(); },
  });
  return { lines, stream };
}

describe('teachLogger (hitl-service)', () => {
  it('keeps token visible (no redaction)', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.info('challenge', { access_token: 'eyJ.h.s', challengeId: 'c1' });
    expect(lines[0].service).toBe('hitl-service');
    expect(lines[0].access_token).toBe('eyJ.h.s');
    expect(lines[0].challengeId).toBe('c1');
  });
  it('step() narrates with [TEACH] marker', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.step(7, 9, 'HITL challenge created', { challengeId: 'c1' });
    expect(lines[0].msg).toBe('[TEACH] step 7/9: HITL challenge created');
    expect(lines[0].teach).toBe(true);
  });
  it('error() carries stack + operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.error('notify failed', new Error('boom'), { operation: 'notify' });
    expect(lines[0].err.message).toBe('boom');
    expect(lines[0].operation).toBe('notify');
  });
  it('LOG_LEVEL filters debug at info', () => {
    const c = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'info', stream: c.stream });
    log.debug('d');
    expect(c.lines).toHaveLength(0);
  });
  it('reserved keys do not clobber pino keys', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.info('m', { level: 'X', service: 'Y' });
    expect(lines[0].service).toBe('hitl-service');
    expect(typeof lines[0].level).toBe('number');
    expect(lines[0].field_level).toBe('X');
  });
  it('auto-injects correlation_id from ALS on every line', async () => {
    const { Writable } = require('stream');
    const { runWithCorrelation } = require('../src/correlationContext');
    const { createTeachLogger } = require('../src/teachLogger');
    const lines = [];
    const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    await runWithCorrelation('corr-xyz', async () => {
      log.info('a');
      log.step(1, 2, 'b');
      log.error('c', new Error('e'));
    });
    log.info('outside');
    expect(lines[0].correlation_id).toBe('corr-xyz');
    expect(lines[1].correlation_id).toBe('corr-xyz');
    expect(lines[2].correlation_id).toBe('corr-xyz');
    expect(lines[3].correlation_id).toBeUndefined();
  });
  it('caller field cannot clobber correlation_id', async () => {
    const { Writable } = require('stream');
    const { runWithCorrelation } = require('../src/correlationContext');
    const { createTeachLogger } = require('../src/teachLogger');
    const lines = [];
    const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    await runWithCorrelation('real-id', async () => {
      log.info('m', { correlation_id: 'FAKE' });
    });
    expect(lines[0].correlation_id).toBe('real-id');
    expect(lines[0].field_correlation_id).toBe('FAKE');
  });
});
