/**
 * CIBAPanel — the "CIBA + MCP step-up" tab renders CibaMcpFlowContent (previously
 * exported but shown by no panel), including the CIBA + token exchange sequence.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('axios', () => {
  const ok = () => Promise.resolve({ data: {} });
  const inst = { get: vi.fn(ok), post: vi.fn(ok), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  return { default: { ...inst, create: () => inst } };
});
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifyInfo: vi.fn(), notifySuccess: vi.fn() }));

const { default: CIBAPanel } = await import('../CIBAPanel');

test('the CIBA + MCP step-up tab shows the CIBA + token exchange sequence diagram', async () => {
  render(<CIBAPanel />);
  // The Learning Hub opens the drawer with this event.
  act(() => { window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } })); });
  fireEvent.click(screen.getByRole('button', { name: 'CIBA + MCP step-up' }));
  expect(await screen.findByText('CIBA + token exchange together')).toBeInTheDocument();
  expect(screen.getByLabelText(/CIBA plus token exchange sequence diagram/i)).toBeInTheDocument();
});
