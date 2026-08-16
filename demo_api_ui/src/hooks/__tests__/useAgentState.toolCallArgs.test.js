import { renderHook, act } from '@testing-library/react';
import { useAgentState } from '../useAgentState';

// AG-UI TOOL_CALL_ARGS deltas are partial JSON fragments. Parsing each fragment
// in isolation throws on every partial, so the previous per-delta parse left
// args stuck at null whenever a provider split them across chunks (bug #64).
// The fix accumulates the raw string and parses once at TOOL_CALL_END.
describe('useAgentState — streaming TOOL_CALL_ARGS accumulation (bug #64)', () => {
  function toolCall(result) {
    return result.current.state.toolCalls.find((c) => c.id === 't1');
  }

  it('accumulates fragmented args and parses once at TOOL_CALL_END', () => {
    const { result } = renderHook(() => useAgentState());

    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'get_account' });
    });
    // Fragmented across three deltas — none is valid JSON on its own.
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"account' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '_id":"acc' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '-123"}' });
    });

    // Before END, args is still null (parsed once at END, not per fragment).
    expect(toolCall(result).args).toBeNull();

    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' });
    });

    const call = toolCall(result);
    expect(call.args).toEqual({ account_id: 'acc-123' });
    expect(call.status).toBe('done');
  });

  it('parses a single-fragment args payload at END', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'get_account' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"q":"hi"}' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' });
    });
    expect(toolCall(result).args).toEqual({ q: 'hi' });
  });

  it('resets the accumulator between tool calls so a later call is not polluted', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'a' });
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"x":1}' });
      result.current.handlers.onEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TOOL_CALL_START', toolCallId: 't2', toolCallName: 'b' });
      result.current.handlers.onEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't2', delta: '{"y":2}' });
      result.current.handlers.onEvent({ type: 'TOOL_CALL_END', toolCallId: 't2' });
    });
    const t2 = result.current.state.toolCalls.find((c) => c.id === 't2');
    expect(t2.args).toEqual({ y: 2 });
  });
});
