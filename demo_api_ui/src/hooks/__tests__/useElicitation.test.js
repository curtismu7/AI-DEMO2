/**
 * submitElicitation's catch block logged the error to console and re-enabled
 * the submit button, but never exposed any error state to the caller -- the
 * elicitation dialog silently reset to idle on a failed submission, with no
 * indication to the user that anything went wrong.
 */
import { renderHook, act } from '@testing-library/react';
import useElicitation from '../useElicitation';

vi.mock('../../services/bffAxios', () => ({
  default: { post: vi.fn() },
}));

import bffAxios from '../../services/bffAxios';

describe('useElicitation submit-error state', () => {
  beforeEach(() => {
    bffAxios.post.mockReset();
  });

  it('exposes an error and keeps the dialog open when the submit POST rejects', async () => {
    bffAxios.post.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useElicitation());

    act(() => {
      result.current.handleElicitationRequest({
        elicitationId: 'el-1', mode: 'form', message: 'm', requestedSchema: {},
      });
    });
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.submitElicitation({ action: 'accept', content: {} });
    });

    expect(result.current.error).toMatch(/failed to send/i);
    expect(result.current.elicitation).not.toBeNull(); // dialog stays open
  });

  it('clears any prior error on a successful submit', async () => {
    bffAxios.post.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useElicitation());

    act(() => {
      result.current.handleElicitationRequest({
        elicitationId: 'el-1', mode: 'form', message: 'm', requestedSchema: {},
      });
    });

    await act(async () => {
      await result.current.submitElicitation({ action: 'accept', content: {} });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.elicitation).toBeNull(); // dialog closed
  });
});
