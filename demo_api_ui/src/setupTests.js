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

// jsdom does not implement scrollTo either — without this stub, rAF-driven
// chat autoscroll (AIAgent) throws 29 unhandled "el.scrollTo is not a
// function" errors and vitest exits 1 even when every test passes.
window.HTMLElement.prototype.scrollTo = vi.fn();

// jsdom does not implement matchMedia — components that read a responsive
// breakpoint on mount (e.g. AdminSideNav's collapse-below-768px check) throw
// "window.matchMedia is not a function" without this stub.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// In Node.js v22+, `localStorage` is an experimental getter that returns
// undefined (requires --localstorage-file). jsdom provides window.localStorage
// but it may not be aliased to the bare `localStorage` global in all Vitest
// worker configurations. Ensure the bare global points to jsdom's store so
// tests that call localStorage.getItem / .setItem / .clear() work correctly.
//
// Snapshot the store BEFORE aliasing. A `get: () => window.localStorage` accessor
// recurses forever when window.localStorage is itself bound to globalThis.localStorage
// (common under Vitest + Node 20+/22 Storage shims).
if (typeof window !== "undefined") {
  if (window.localStorage) {
    const jsdomLocalStorage = window.localStorage;
    try {
      Object.defineProperty(globalThis, "localStorage", {
        value: jsdomLocalStorage,
        writable: true,
        configurable: true,
      });
    } catch (_) {
      try {
        globalThis.localStorage = jsdomLocalStorage;
      } catch (_2) {
        /* best-effort */
      }
    }
  } else {
    // Fallback: create an in-memory localStorage mock for Node.js v22+
    // Must use fresh store per test file to avoid state leakage.
    // Each test file's beforeEach will install a fresh mock.
    const createLocalStorageMock = () => {
      const mockStorage = {};
      return {
        getItem: (key) =>
          Object.prototype.hasOwnProperty.call(mockStorage, key)
            ? mockStorage[key]
            : null,
        setItem: (key, value) => {
          mockStorage[key] = String(value);
        },
        removeItem: (key) => {
          delete mockStorage[key];
        },
        clear: () => {
          Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
        },
        key: (index) => Object.keys(mockStorage)[index] ?? null,
        get length() {
          return Object.keys(mockStorage).length;
        },
      };
    };

    // Install initial fallback at module load.
    // Test files can call this hook in their own beforeEach to reset per test.
    let localStorageMock = createLocalStorageMock();
    try {
      Object.defineProperty(globalThis, "localStorage", {
        get: () => localStorageMock,
        set: (value) => {
          localStorageMock = value;
        },
        configurable: true,
      });
    } catch (_) {
      globalThis.localStorage = localStorageMock;
    }
    if (window) {
      try {
        window.localStorage = localStorageMock;
      } catch (_) {
        /* best-effort */
      }
    }

    // Export for test files to reset per test.
    globalThis._createLocalStorageMock = createLocalStorageMock;
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
