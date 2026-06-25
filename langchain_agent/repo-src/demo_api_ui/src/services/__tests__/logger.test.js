import { createLogger } from '../logger';

describe('createLogger', () => {
  let spy;

  beforeEach(() => {
    spy = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it('prefixes output with [name]', () => {
    const log = createLogger('myService');
    log.warn('something happened');
    expect(spy.warn).toHaveBeenCalledWith('[myService]', 'something happened');
  });

  it('debug calls console.log in dev', () => {
    const log = createLogger('svc');
    // eslint-disable-next-line testing-library/no-debugging-utils
    log.debug('msg', 1);
    // eslint-disable-next-line no-console
    expect(spy.log).toHaveBeenCalledWith('[svc]', 'msg', 1);
  });

  it('info calls console.info in dev', () => {
    const log = createLogger('svc');
    log.info('msg');
    expect(spy.info).toHaveBeenCalledWith('[svc]', 'msg');
  });

  it('warn always calls console.warn', () => {
    const log = createLogger('svc');
    log.warn('oops');
    expect(spy.warn).toHaveBeenCalledWith('[svc]', 'oops');
  });

  it('error always calls console.error', () => {
    const log = createLogger('svc');
    log.error('fail', { code: 500 });
    expect(spy.error).toHaveBeenCalledWith('[svc]', 'fail', { code: 500 });
  });

  it('passes multiple arguments through', () => {
    const log = createLogger('multi');
    log.warn('a', 'b', 'c');
    expect(spy.warn).toHaveBeenCalledWith('[multi]', 'a', 'b', 'c');
  });
});
