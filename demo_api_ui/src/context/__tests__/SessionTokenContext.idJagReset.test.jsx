import { act, render } from '@testing-library/react';
import { SessionTokenProvider } from '../SessionTokenContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../services/sessionResolver', () => ({ resolveSessionExpiry: vi.fn().mockResolvedValue(null) }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: { getState: vi.fn(), reset: vi.fn() },
}));

test('ordinary login and logout clear ID-JAG visual state while a validated callback preserves it', () => {
  tokenChainTraceStore.getState.mockReturnValue({ trace: { mode: 'mock-id-jag', provenance: 'mock-id-jag' } });
  render(<SessionTokenProvider><div>child</div></SessionTokenProvider>);
  act(() => window.dispatchEvent(new CustomEvent('userAuthenticated', { detail: { idJagCallbackValidated: true } })));
  expect(tokenChainTraceStore.reset).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event('userAuthenticated')));
  expect(tokenChainTraceStore.reset).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('userLoggedOut')));
  expect(tokenChainTraceStore.reset).toHaveBeenCalledTimes(2);
});
