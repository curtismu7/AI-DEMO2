import { renderHook, act } from '@testing-library/react';
import { useAgentState } from '../useAgentState';

// The UC24 public catalog rides the terminating event: agentRun.js answers
// branch_hours deterministically and attaches the locations to TEXT_MESSAGE_END.
// Before this, the AG-UI path had no way to carry them, so a prompt that resolved
// to the catalog rendered the heading with no cards — the cards only ever appeared
// on the non-AG-UI (Heuristics) path, which applies locationCardsExtra instead.
describe('useAgentState — locationCards on TEXT_MESSAGE_END', () => {
  function stream(result, endEvent) {
    act(() => {
      result.current.handlers.onEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
    });
    act(() => {
      result.current.handlers.onEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Super Banking branch locations — found 2:' });
    });
    act(() => {
      result.current.handlers.onEvent(endEvent);
    });
    return result.current.state.messages.find((m) => m.id === 'm1');
  }

  it('carries locationCards onto the finished message', () => {
    const { result } = renderHook(() => useAgentState());
    const cards = [
      { id: 'b1', name: 'Super Banking Main Branch', address: '100 Congress Ave' },
      { id: 'b2', name: 'Super Banking Dallas Branch', address: '2000 Ross Ave' },
    ];
    const msg = stream(result, { type: 'TEXT_MESSAGE_END', messageId: 'm1', locationCards: cards });

    expect(msg.streaming).toBe(false);
    expect(msg.locationCards).toEqual(cards);
    expect(msg.content).toContain('branch locations');
  });

  it('leaves the message shape untouched when the event carries no cards', () => {
    const { result } = renderHook(() => useAgentState());
    const msg = stream(result, { type: 'TEXT_MESSAGE_END', messageId: 'm1' });

    expect(msg.streaming).toBe(false);
    expect('locationCards' in msg).toBe(false);
  });

  it('ignores a non-array locationCards rather than passing junk to the renderer', () => {
    const { result } = renderHook(() => useAgentState());
    const msg = stream(result, { type: 'TEXT_MESSAGE_END', messageId: 'm1', locationCards: 'nope' });

    expect('locationCards' in msg).toBe(false);
  });
});
