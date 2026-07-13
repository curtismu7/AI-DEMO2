import { renderHook, act } from '@testing-library/react';
import { useAgentState } from '../useAgentState';

describe('useAgentState — grounding_correction CUSTOM event', () => {
  it('stores the correction payload in state.lastGroundingCorrection', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'grounding_correction',
        value: {
          original: "I've waived your fee!",
          corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
          correctionNote: 'overclaim',
        },
      });
    });
    expect(result.current.state.lastGroundingCorrection).toEqual({
      original: "I've waived your fee!",
      corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
      correctionNote: 'overclaim',
    });
  });

  it('resets lastGroundingCorrection to null on RUN_STARTED', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'grounding_correction',
        value: { original: 'a', corrected: 'b', correctionNote: 'c' },
      });
    });
    expect(result.current.state.lastGroundingCorrection).not.toBeNull();
    act(() => {
      result.current.handlers.onEvent({ type: 'RUN_STARTED' });
    });
    expect(result.current.state.lastGroundingCorrection).toBeNull();
  });

  it('ignores CUSTOM events with other names', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'token_usage',
        value: { inputTokens: 1, outputTokens: 2 },
      });
    });
    expect(result.current.state.lastGroundingCorrection).toBeNull();
  });
});
