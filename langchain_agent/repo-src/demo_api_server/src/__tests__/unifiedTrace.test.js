'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const unifiedTrace = require('../../services/unifiedTrace');

describe('unifiedTrace', () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  describe('formatTransactionBlock', () => {
    it('renders a ═══ header, per-hop steps, and a footer', () => {
      const block = unifiedTrace.formatTransactionBlock({
        type: 'MCP: TOOL_CALL',
        timestamp: '2026-06-09T14:57:00.000Z',
        correlationId: 'agent-123',
        userSub: '4511829e-44a0',
        tool: 'view_records',
        steps: unifiedTrace.buildMcpHopSteps({
          tokenAud: 'mcpgateway.ping.demo',
          gwAuditTrail: { introspection: { active: true, sub: '4511829e' }, authorize: { decision: 'PERMIT' } },
          result: { isError: false },
        }),
        outcome: { ok: true, durationMs: 42 },
      });

      expect(block).toContain('TRANSACTION: MCP: TOOL_CALL');
      expect(block).toContain('correlation_id: agent-123');
      expect(block).toContain('token_aud: mcpgateway.ping.demo');
      expect(block).toContain('GATEWAY PINGONE AUTHORIZE');
      expect(block).toContain('PERMIT');
      expect(block).toContain('RESULT: ✅ success');
      expect(block).toContain('(42ms)');
      expect(block).toMatch(/═{72}/);
      expect(block).toMatch(/─{72}/);
    });

    it('marks the failing forward hop on a gateway PERMIT → forward-401', () => {
      const block = unifiedTrace.formatTransactionBlock({
        type: 'MCP: TOOL_CALL',
        timestamp: '2026-06-09T14:57:00.000Z',
        tool: 'view_records',
        steps: unifiedTrace.buildMcpHopSteps({
          tokenAud: 'mcpgateway.ping.demo',
          gwAuditTrail: { introspection: { active: true }, authorize: { decision: 'PERMIT' } },
          error: Object.assign(new Error('Gateway authentication failed — Invalid or expired token'), {
            httpStatus: 401,
            gatewayErrorCode: 'unauthorized',
          }),
        }),
        outcome: { ok: false, detail: 'Invalid or expired token', durationMs: 13 },
      });

      // The gateway permitted, but the downstream forward step is flagged ❌ —
      // localising the break to the gateway→server hop at a glance.
      expect(block).toContain('GATEWAY PINGONE AUTHORIZE');
      expect(block).toContain('PERMIT');
      expect(block).toContain('GATEWAY → MCP SERVER (FORWARD) ❌');
      expect(block).toContain('Invalid or expired token');
      expect(block).toContain('RESULT: ❌ failure');
    });

    it('normalises an array aud', () => {
      const steps = unifiedTrace.buildMcpHopSteps({ tokenAud: ['a.demo', 'b.demo'] });
      const block = unifiedTrace.formatTransactionBlock({ type: 'X', steps });
      expect(block).toContain('token_aud: a.demo, b.demo');
    });
  });

  describe('writeTransaction gating', () => {
    it('is a no-op when file logging is disabled', () => {
      delete process.env.ENABLE_FILE_LOGGING;
      process.env.LOG_DIRECTORY = '/tmp/should-not-be-written';
      expect(unifiedTrace.writeTransaction({ type: 'X' })).toBe(false);
    });

    it('appends a block when enabled', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-trace-'));
      process.env.ENABLE_FILE_LOGGING = 'true';
      process.env.LOG_DIRECTORY = dir;

      const wrote = unifiedTrace.writeTransaction({
        type: 'MCP: TOOL_CALL',
        tool: 'get_my_accounts',
        steps: unifiedTrace.buildMcpHopSteps({ tokenAud: 'mcpgateway.ping.demo', result: { isError: false } }),
        outcome: { ok: true },
      });

      expect(wrote).toBe(true);
      const written = fs.readFileSync(path.join(dir, unifiedTrace.FILE_NAME), 'utf8');
      expect(written).toContain('TRANSACTION: MCP: TOOL_CALL');
      expect(written).toContain('get_my_accounts');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('never throws on a bad LOG_DIRECTORY', () => {
      // Point LOG_DIRECTORY *under an existing file* — mkdirSync then fails fast
      // with ENOTDIR on every platform. (The previous value '/proc/cannot/create/here'
      // was a Linux-only path whose mkdir behaviour on the CI runner hung the whole
      // shard; never touch /proc from a test.)
      const badFile = path.join(os.tmpdir(), `unified-trace-badfile-${process.pid}`);
      fs.writeFileSync(badFile, 'x');
      process.env.ENABLE_FILE_LOGGING = 'true';
      process.env.LOG_DIRECTORY = path.join(badFile, 'cannot', 'be', 'a', 'dir');
      try {
        expect(() => unifiedTrace.writeTransaction({ type: 'X' })).not.toThrow();
      } finally {
        fs.rmSync(badFile, { force: true });
      }
    });
  });
});
