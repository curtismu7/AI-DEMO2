// Regression: the gateway api_key dispatch path returns the raw MCP content
// envelope ({ content:[{type:'text',text:'<inner JSON>'}], isError }) as
// body.result. executeBffTool must unwrap it to the inner tool JSON so the
// vertical render layer sees `.render`/`.data` instead of dumping the frame as
// plain text in the chat (manufacturing "view_work_orders" showed raw data on
// all agent modes). Mirrors callMcpToolInternal, which already returns
// content[0].text.
'use strict';

const { unwrapMcpResultEnvelope } = require('../../services/bffMcpToolExecutor');
const { parseMcpToolPayload } = require('../../services/verticalMcpExecution');

describe('MCP content envelope unwrapping (bffMcpToolExecutor)', () => {
  const innerJson = JSON.stringify({
    success: true,
    render: 'view_work_orders',
    data: { workOrders: [{ id: 'WO-4004', status: 'Released', dueDate: '2026-06-20' }] },
  });

  test('unwraps an MCP content envelope to its inner text', () => {
    const envelope = { content: [{ type: 'text', text: innerJson }], isError: false };
    expect(unwrapMcpResultEnvelope(envelope)).toBe(innerJson);
  });

  test('leaves an already-unwrapped inner object untouched', () => {
    const inner = { accounts: [{ accountNumber: '123', balance: 10 }] };
    expect(unwrapMcpResultEnvelope(inner)).toBe(inner);
  });

  test('leaves a content array without a text part untouched', () => {
    const noText = { content: [{ type: 'image', data: 'x' }], isError: false };
    expect(unwrapMcpResultEnvelope(noText)).toBe(noText);
  });

  test('wraps a bare non-JSON isError text so the message is not dropped', () => {
    const errEnvelope = { content: [{ type: 'text', text: 'Backend unavailable' }], isError: true };
    const out = JSON.parse(unwrapMcpResultEnvelope(errEnvelope));
    expect(out.error).toBe('Backend unavailable');
    // and it surfaces as an error reply rather than an empty render
    const payload = parseMcpToolPayload(unwrapMcpResultEnvelope(errEnvelope));
    expect(payload.out.result.error).toBe('Backend unavailable');
  });

  test('passes through JSON isError text untouched (embedded .error preserved)', () => {
    const errEnvelope = { content: [{ type: 'text', text: '{"error":"insufficient_funds"}' }], isError: true };
    expect(unwrapMcpResultEnvelope(errEnvelope)).toBe('{"error":"insufficient_funds"}');
  });

  test('handles null/undefined without throwing', () => {
    expect(unwrapMcpResultEnvelope(null)).toBeNull();
    expect(unwrapMcpResultEnvelope(undefined)).toBeUndefined();
  });

  test('unwrapped text flows through parseMcpToolPayload to the correct render', () => {
    const envelope = { content: [{ type: 'text', text: innerJson }], isError: false };
    const unwrapped = unwrapMcpResultEnvelope(envelope);
    const out = parseMcpToolPayload(unwrapped);
    expect(out.kind).toBe('out');
    expect(out.out.render).toBe('view_work_orders');
    expect(out.out.result.workOrders).toHaveLength(1);
  });

  test('the un-unwrapped envelope would render as plain text (the bug)', () => {
    // Documents the pre-fix behaviour: feeding the raw envelope straight to the
    // render layer yields render:'text' with the whole frame as the payload.
    const envelope = { content: [{ type: 'text', text: innerJson }], isError: false };
    const out = parseMcpToolPayload(envelope);
    expect(out.out.render).toBe('text');
  });
});
