// Polyfills required by react-router-dom v6/7 when running via `npx jest`
// (outside CRA's react-scripts, which provides these through jsdom setup).
// Loaded via setupFiles — runs before the test framework is installed.
const { TextEncoder, TextDecoder } = require('util');
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

if (typeof global.EventSource === 'undefined') {
  class EventSourceStub {
    constructor() { this.readyState = 0; this.onmessage = null; this.onerror = null; this.onopen = null; }
    addEventListener() {} removeEventListener() {} close() { this.readyState = 2; }
  }
  EventSourceStub.CONNECTING = 0; EventSourceStub.OPEN = 1; EventSourceStub.CLOSED = 2;
  global.EventSource = EventSourceStub;
}
