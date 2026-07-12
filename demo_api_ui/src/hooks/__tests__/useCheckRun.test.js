import { deriveVerdict, readSse } from '../useCheckRun';

describe('deriveVerdict', () => {
  test('null when empty', () => { expect(deriveVerdict({})).toBe(null); });
  test('ready when all pass', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'skip' } })).toBe('ready');
  });
  test('warn precedence', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'warn' } })).toBe('ready_with_warnings');
  });
  test('fail wins', () => {
    expect(deriveVerdict({ a: { status: 'warn' }, b: { status: 'fail' } })).toBe('not_ready');
  });
});

describe('readSse', () => {
  test('delivers the final frame even without a trailing blank line', async () => {
    const chunks = [
      'event: result\ndata: {"id":"a","status":"pass"}\n\n',
      'event: result\ndata: {"id":"b","status":"pass"}',
    ];
    let i = 0;
    const encoder = new TextEncoder();
    const fakeResponse = {
      body: {
        getReader() {
          return {
            read: async () => {
              if (i < chunks.length) {
                const value = encoder.encode(chunks[i]);
                i += 1;
                return { value, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    };

    const delivered = [];
    await readSse(fakeResponse, (ev, data) => delivered.push([ev, data]));

    expect(delivered).toContainEqual(['result', { id: 'a', status: 'pass' }]);
    expect(delivered).toContainEqual(['result', { id: 'b', status: 'pass' }]);
  });
});
