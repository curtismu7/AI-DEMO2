import { Writable } from 'stream';

import { createTeachLogger } from '../../src/utils/teachLogger';
import { runWithCorrelation } from '../../src/utils/correlationContext';

function capture(): { lines: any[]; stream: Writable } {
  const lines: any[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe('teachLogger', () => {
  it('emits a structured info line with fields and never redacts a token', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig';
    log.info('token received', { access_token: fakeJwt, sub: 'user1' });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('token received');
    expect(lines[0].service).toBe('mcp-server');
    expect(lines[0].access_token).toBe(fakeJwt);
  });

  it('step() emits a [TEACH] narration marker with n/total', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.step(3, 9, 'RFC 8693 exchange', { resource: 'mcp' });
    expect(lines[0].msg).toBe('[TEACH] step 3/9: RFC 8693 exchange');
    expect(lines[0].resource).toBe('mcp');
    expect(lines[0].teach).toBe(true);
  });

  it('error() captures message, stack and operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.error('exchange failed', new Error('boom'), { operation: 'rfc8693' });
    expect(lines[0].level).toBe(50);
    expect(lines[0].err.message).toBe('boom');
    expect(typeof lines[0].err.stack).toBe('string');
    expect(lines[0].operation).toBe('rfc8693');
  });

  it('respects LOG_LEVEL via level option (debug shown, then info filters debug)', () => {
    const c1 = capture();
    const debugLog = createTeachLogger({ service: 's', level: 'debug', stream: c1.stream });
    debugLog.debug('d');
    expect(c1.lines).toHaveLength(1);

    const c2 = capture();
    const infoLog = createTeachLogger({ service: 's', level: 'info', stream: c2.stream });
    infoLog.debug('d');
    expect(c2.lines).toHaveLength(0);
  });

  it('child() binds fields and carries both bound + per-call fields, inheriting level', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    const child = log.child({ operation: 'rfc8693' });
    child.info('child msg', { extra: 'data' });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('child msg');
    expect(lines[0].operation).toBe('rfc8693');
    expect(lines[0].extra).toBe('data');
    expect(lines[0].service).toBe('mcp-server');
    // child inherits debug level — debug messages should appear
    child.debug('child debug');
    expect(lines).toHaveLength(2);
  });

  it('resolveLevel reads process.env.LOG_LEVEL when no level option is set', () => {
    const savedLevel = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = 'warn';
      const { lines, stream } = capture();
      // No level option — resolveLevel should pick up LOG_LEVEL='warn'
      const log = createTeachLogger({ service: 'mcp-server', stream });
      log.info('should be filtered');
      expect(lines).toHaveLength(0);
      log.warn('should appear');
      expect(lines).toHaveLength(1);
      expect(lines[0].msg).toBe('should appear');
      expect(lines[0].level).toBe(40);
    } finally {
      if (savedLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = savedLevel;
      }
    }
  });

  it('error() with a non-Error value puts it under err', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.error('something failed', 'string error value');
    expect(lines).toHaveLength(1);
    expect(lines[0].err).toBe('string error value');
  });

  it('field-collision: caller fields with reserved keys are prefixed with field_', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.info('collision test', { level: 'X', service: 'Y', msg: 'Z', operation: 'safe' });
    expect(lines).toHaveLength(1);
    // pino's real numeric level must survive
    expect(lines[0].level).toBe(30);
    // pino's real service from base must survive
    expect(lines[0].service).toBe('mcp-server');
    // caller values appear under prefixed keys
    expect(lines[0].field_level).toBe('X');
    expect(lines[0].field_service).toBe('Y');
    // non-reserved fields pass through normally
    expect(lines[0].operation).toBe('safe');
  });
  it('auto-injects correlation_id from ALS on every line', async () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
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
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    await runWithCorrelation('real-id', async () => {
      log.info('m', { correlation_id: 'FAKE' });
    });
    expect(lines[0].correlation_id).toBe('real-id');
    expect(lines[0].field_correlation_id).toBe('FAKE');
  });
});
