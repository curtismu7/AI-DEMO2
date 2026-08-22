import { openMcpToolStream } from '../webMcpClient';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }
}
FakeEventSource.CONNECTING = 0;
FakeEventSource.OPEN = 1;
FakeEventSource.CLOSED = 2;

describe('openMcpToolStream', () => {
  const realEventSource = global.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    global.EventSource = FakeEventSource;
  });

  afterEach(() => {
    global.EventSource = realEventSource;
  });

  it('does not close the stream on a transient error (readyState CONNECTING)', () => {
    openMcpToolStream('trace-1', () => {});
    const es = FakeEventSource.instances[0];
    es.readyState = 0; // CONNECTING — browser is auto-reconnecting
    es.onerror();
    expect(es.closed).toBe(false);
  });

  it('closes the stream once the server has cleanly closed it (readyState CLOSED)', () => {
    openMcpToolStream('trace-2', () => {});
    const es = FakeEventSource.instances[0];
    es.readyState = 2; // CLOSED
    es.onerror();
    expect(es.closed).toBe(true);
  });
});
