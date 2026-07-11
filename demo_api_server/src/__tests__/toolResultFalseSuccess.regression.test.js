'use strict';

/**
 * Regression: an unparseable executeBffTool result at the write sites
 * (transfer/deposit/withdraw) used to classify as kind:'ok' —
 * classifyMcpToolResult(null) returns {kind:'ok'} — so the agent reported
 * "Transferred $X" success with no readable result. parseToolResult must
 * convert it to an error the classifier surfaces.
 */
const { classifyMcpToolResult } = require('../../services/mcpToolOutcome');
const { parseToolResult } = require('../../services/llmResponseContract');

describe('unparseable write-tool result is an error, not success', () => {
  it('documents the pre-fix hazard: classify(null) is ok', () => {
    expect(classifyMcpToolResult(null).kind).toBe('ok'); // why the old parse-to-null pattern lied
  });

  it('parseToolResult + classifier yields kind:error for garbage', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = parseToolResult('<html>502 Bad Gateway</html>', { site: 'create_transfer' });
    expect(classifyMcpToolResult(result).kind).toBe('error');
    spy.mockRestore();
  });
});

describe('parseMcpToolPayload never renders the {} garble', () => {
  it('unparseable raw becomes an error render, not result:{} render:text', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { parseMcpToolPayload } = require('../../services/verticalMcpExecution');
    const out = parseMcpToolPayload('Bad upstream response, not JSON');
    expect(out.kind).toBe('out');
    expect(out.out.render).toBe('text');
    expect(out.out.result.error).toBeTruthy();          // error message, not {}
    expect(out.out.result).not.toEqual({});
    spy.mockRestore();
  });
});
