import { renderHook, act } from '@testing-library/react';
import { useTokenChainSSE } from '../useTokenChainSSE';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }
}

describe('useTokenChainSSE', () => {
  const realEventSource = global.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    global.EventSource = FakeEventSource;
  });

  afterEach(() => {
    global.EventSource = realEventSource;
  });

  it('keeps the stream open on a transient error so the browser can reconnect', () => {
    renderHook(() => useTokenChainSSE());
    const es = FakeEventSource.instances[0];
    es.readyState = 0; // CONNECTING — browser is auto-reconnecting
    act(() => { es.onerror(); });
    expect(es.closed).toBe(false);
  });

  it('closes the stream once it has terminally closed', () => {
    renderHook(() => useTokenChainSSE());
    const es = FakeEventSource.instances[0];
    es.readyState = 2; // CLOSED
    act(() => { es.onerror(); });
    expect(es.closed).toBe(true);
  });

  it('reports reconnection through onopen', () => {
    const { result } = renderHook(() => useTokenChainSSE());
    const es = FakeEventSource.instances[0];
    es.readyState = 0;
    act(() => { es.onerror(); });
    expect(result.current.isConnected).toBe(false);

    act(() => { es.onopen(); });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
