// jest-dom matchers (toBeInTheDocument, etc.)
import "@testing-library/jest-dom";

// react-router-dom v7 uses TextEncoder/TextDecoder which jsdom doesn't provide globally.
// Polyfill from Node's built-in 'util' so all tests that import react-router-dom work.
import { TextEncoder, TextDecoder } from "util";

// Vitest migration: expose `jest` as alias for `vi` so existing test files
// written against the Jest API (jest.fn, jest.useFakeTimers, etc.) work
// without a mass rename. vi.mock() hoisting still requires using vi.mock()
// directly in each file — this alias only covers non-hoisted calls.
global.jest = vi;

// jsdom does not implement scrollIntoView — mock it globally
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// In Node.js v22+, `localStorage` is an experimental getter that returns
// undefined (requires --localstorage-file). jsdom provides window.localStorage
// but it may not be aliased to the bare `localStorage` global in all Vitest
// worker configurations. Ensure the bare global points to jsdom's store so
// tests that call localStorage.getItem / .setItem / .clear() work correctly.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    Object.defineProperty(globalThis, "localStorage", {
      get: () => window.localStorage,
      configurable: true,
    });
  } catch (_) {
    try {
      globalThis.localStorage = window.localStorage;
    } catch (_2) {
      /* best-effort */
    }
  }
}
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// jsdom does not implement EventSource. Components that open a server-sent
// events stream on mount (e.g. VerticalProvider → /api/verticals/stream) throw
// "ReferenceError: EventSource is not defined" when rendered in tests that
// don't mock it. Provide a minimal no-op stub so rendering succeeds; suites
// that assert SSE behaviour install their own mock over this.
if (typeof global.EventSource === "undefined") {
  class EventSourceStub {
    constructor() {
      this.readyState = 0;
      this.onmessage = null;
      this.onerror = null;
      this.onopen = null;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.readyState = 2;
    }
  }
  EventSourceStub.CONNECTING = 0;
  EventSourceStub.OPEN = 1;
  EventSourceStub.CLOSED = 2;
  global.EventSource = EventSourceStub;
}
