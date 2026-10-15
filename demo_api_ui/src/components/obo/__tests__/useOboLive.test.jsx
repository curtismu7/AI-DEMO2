import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useOboLive from "../useOboLive";

class FakeEventSource {
  static instances = [];
  constructor(url, opts) { this.url = url; this.opts = opts; this.closed = false; FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

beforeEach(() => { FakeEventSource.instances = []; globalThis.EventSource = FakeEventSource; });
afterEach(() => { delete globalThis.EventSource; });

describe("useOboLive", () => {
  it("opens one credentialed stream and returns events newest first, capped at 5", () => {
    const { result } = renderHook(() => useOboLive(true));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toMatch(/\/api\/obo\/events$/);
    expect(FakeEventSource.instances[0].opts).toEqual({ withCredentials: true });
    act(() => { for (let n = 1; n <= 7; n += 1) FakeEventSource.instances[0].emit({ n }); });
    expect(result.current.map((e) => e.n)).toEqual([7, 6, 5, 4, 3]);
  });

  it("ignores a malformed frame without throwing", () => {
    const { result } = renderHook(() => useOboLive(true));
    act(() => { FakeEventSource.instances[0].onmessage({ data: "not json" }); });
    expect(result.current).toEqual([]);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useOboLive(true));
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("opens nothing when disabled", () => {
    renderHook(() => useOboLive(false));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("returns an empty list and does not throw when EventSource is unavailable", () => {
    delete globalThis.EventSource;
    const { result } = renderHook(() => useOboLive(true));
    expect(result.current).toEqual([]);
  });
});
