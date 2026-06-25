const { EventEmitter } = require('events');
const { createEvents } = require('../../services/verticalManifest/events');

function fakeRes() {
  const ee = new EventEmitter();
  return {
    headers: {}, headWritten: false, body: [],
    setHeader(k, v) { this.headers[k] = v; },
    writeHead() { this.headWritten = true; },
    write(s) { this.body.push(s); },
    end() { ee.emit('close'); },
    on(evt, cb) { ee.on(evt, cb); },
  };
}

describe('events', () => {
  test('emit() reaches registered client', () => {
    const events = createEvents({ getInitialActiveId: () => 'banking' });
    const res = fakeRes();
    events.onClient({}, res);
    events.emit('vertical-edited', { id: 'healthcare' });
    const joined = res.body.join('');
    expect(joined).toContain('event: vertical-edited');
    expect(joined).toContain('"id":"healthcare"');
  });

  test('initial vertical-switched sent on connect', () => {
    const events = createEvents({ getInitialActiveId: () => 'banking' });
    const res = fakeRes();
    events.onClient({}, res);
    const joined = res.body.join('');
    expect(joined).toContain('event: vertical-switched');
    expect(joined).toContain('"activeId":"banking"');
  });

  test('no initial event when there is no active id', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    const joined = res.body.join('');
    expect(joined).not.toContain('event: vertical-switched');
  });

  test('client close removes listener; no errors on later emit', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    res.end();    // simulate client disconnect
    expect(() => events.emit('vertical-edited', { id: 'x' })).not.toThrow();
    expect(events._clientCount()).toBe(0);
  });

  test('vertical-list-changed event type fires', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    res.body.length = 0;  // discard hydration
    events.emit('vertical-list-changed', { ids: ['a', 'b'] });
    expect(res.body.join('')).toContain('event: vertical-list-changed');
  });

  test('a client whose write throws is dropped on emit (no zombie)', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    expect(events._clientCount()).toBe(1);
    // Simulate a dead socket: write now throws (the 'close' event never fired).
    res.write = () => { throw new Error('EPIPE'); };
    expect(() => events.emit('vertical-edited', { id: 'x' })).not.toThrow();
    expect(events._clientCount()).toBe(0);
    // A second emit must not re-attempt the removed client.
    expect(() => events.emit('vertical-edited', { id: 'y' })).not.toThrow();
  });

  test('two clients both receive emit', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const r1 = fakeRes();
    const r2 = fakeRes();
    events.onClient({}, r1);
    events.onClient({}, r2);
    events.emit('vertical-edited', { id: 'banking' });
    expect(r1.body.join('')).toContain('event: vertical-edited');
    expect(r2.body.join('')).toContain('event: vertical-edited');
  });
});
