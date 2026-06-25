'use strict';

/**
 * Unit tests for mcpFlowSseHub.js
 *
 * Tests the linger-window buffer behavior introduced to fix the race condition
 * where a browser EventSource GET arrives after the POST response has finished.
 */

const hub = require('../services/mcpFlowSseHub');

function mockReq(sid, traceId) {
  return {
    sessionID: sid,
    query: { trace: traceId },
    on: jest.fn(),
  };
}

function mockRes() {
  const written = [];
  return {
    written,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((data) => written.push(data)),
    end: jest.fn(),
    on: jest.fn(),
  };
}

// Helper to extract written event payloads from a mock res
function writtenPayloads(res) {
  return res.written
    .filter((line) => typeof line === 'string' && line.startsWith('data: '))
    .map((line) => {
      try {
        return JSON.parse(line.slice('data: '.length).replace(/\n\n$/, ''));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

// Use a unique traceId prefix per test to avoid cross-test interference
let _counter = 0;
function uniqueTrace() {
  return `test-trace-${Date.now()}-${++_counter}-xxxxxxxx`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('mcpFlowSseHub — linger-window buffer behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it('events published before endTrace are replayed to a late-arriving SSE subscriber within linger window', () => {
    const traceId = uniqueTrace();
    const sid = 'session-late-subscriber';

    // Claim trace and publish two events
    hub.claimTrace(traceId, sid);
    hub.publish(traceId, { phase: 'tool_start', tool: 'get_accounts' });
    hub.publish(traceId, { phase: 'tool_done', tool: 'get_accounts' });

    // End the trace (publishes stream_end + sets linger timer)
    hub.endTrace(traceId);

    // Late-arriving subscriber — connects AFTER endTrace, within linger window
    const res = mockRes();
    const req = mockReq(sid, traceId);
    hub.handleSseGet(req, res);

    const payloads = writtenPayloads(res);
    const phases = payloads.map((p) => p.phase);

    // Should have received: tool_start, tool_done, stream_end (in buffer order)
    expect(phases).toContain('tool_start');
    expect(phases).toContain('tool_done');
    expect(phases).toContain('stream_end');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it('connected subscriber receives stream_end immediately when endTrace fires', () => {
    const traceId = uniqueTrace();
    const sid = 'session-connected-subscriber';

    // Claim trace and attach subscriber BEFORE endTrace
    hub.claimTrace(traceId, sid);
    const res = mockRes();
    const req = mockReq(sid, traceId);
    hub.handleSseGet(req, res);

    // Publish an event while subscriber is connected
    hub.publish(traceId, { phase: 'tool_start', tool: 'get_balance' });

    // End the trace
    hub.endTrace(traceId);

    const payloads = writtenPayloads(res);
    const phases = payloads.map((p) => p.phase);

    // Connected subscriber should have received tool_start and stream_end
    expect(phases).toContain('tool_start');
    expect(phases).toContain('stream_end');

    // res.end() should have been called immediately (subscriber is closed)
    expect(res.end).toHaveBeenCalled();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it('buffer is available immediately after endTrace but is deleted after linger window', () => {
    const traceId = uniqueTrace();
    const sid = 'session-linger-window';

    hub.claimTrace(traceId, sid);
    hub.publish(traceId, { phase: 'tool_start', tool: 'create_transfer' });
    hub.endTrace(traceId);

    // ── Before linger expires: late subscriber should get events ──
    const resBefore = mockRes();
    const reqBefore = mockReq(sid, traceId);
    hub.handleSseGet(reqBefore, resBefore);

    const payloadsBefore = writtenPayloads(resBefore);
    expect(payloadsBefore.some((p) => p.phase === 'tool_start')).toBe(true);
    expect(payloadsBefore.some((p) => p.phase === 'stream_end')).toBe(true);

    // ── Advance timers past BUFFER_LINGER_MS (10 000 ms) ──
    jest.advanceTimersByTime(11_000);

    // ── After linger expires: a new subscriber connecting with the same
    //    sessionId and traceId should no longer see buffered events.
    //    handleSseGet will re-claim (because traceClaims was deleted by the
    //    linger timeout), creating an empty buffer — so no data events.
    const resAfter = mockRes();
    const reqAfter = mockReq(sid, traceId);
    hub.handleSseGet(reqAfter, resAfter);

    const payloadsAfter = writtenPayloads(resAfter);
    // The buffer was deleted, so no data events should arrive
    expect(payloadsAfter.filter((p) => p.phase === 'tool_start')).toHaveLength(0);
  });
});
