import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SupportConsole from '../SupportConsole';
import { tokenChainTraceStore } from '../../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from '../../../services/apiClient';
import bffAxios from '../../../services/bffAxios';

beforeEach(() => {
  tokenChainTraceStore.reset();
  apiClient.get.mockReset();
  apiClient.post.mockReset();
  bffAxios.get.mockReset();
  bffAxios.post.mockReset();
});

it("the console's track band fetches the support track and the hero button opens it", async () => {
  // permissions + queue resolve harmlessly; only the demo-track call matters here.
  bffAxios.get.mockResolvedValue({ data: {} });
  apiClient.get.mockImplementation((url) => {
    if (String(url).startsWith('/api/demo-track')) {
      return Promise.resolve({ data: { track: { steps: [
        { stepId: 'support-verify', act: 1, title: 'Verify the customer — real sign-on' },
        { stepId: 'support-exchange', act: 1, title: 'Act on their behalf — RFC 8693' },
        { stepId: 'support-write', act: 1, title: 'The write — under the delegated token' },
      ] }, run: { activeStepId: 'support-verify', slots: {} } } });
    }
    return Promise.resolve({ data: {} });
  });

  render(<SupportConsole vertical="workforce" />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/demo-track?track=support'));
  // the band renders the support titles
  await waitFor(() => expect(screen.getAllByText(/Verify the customer/i).length).toBeGreaterThan(0));
  // hero button opens the chain: the outer trace accordion AND the rail's
  // Pipeline accordion (the band lives inside it) are open after the click.
  fireEvent.click(screen.getByRole('button', { name: /demo steps/i }));
  const trace = screen.getByTestId('vops-token-chain');
  expect(trace).toHaveAttribute('open');
  expect(trace.querySelector('details.tctr-acc')).toHaveAttribute('open');
  // ...and the band's titles are actually visible now that the accordions are open
  expect(screen.getAllByText(/Act on their behalf — RFC 8693/i).length).toBeGreaterThan(0);
});
