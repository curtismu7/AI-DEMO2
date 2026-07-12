// demo_api_ui/src/pages/__tests__/CheckPage.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import CheckPage from '../CheckPage';

beforeEach(() => {
  globalThis.fetch = vi.fn((url) => {
    if (String(url).includes('/catalog')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ flags: {}, checks: [{ id: 'servers.all_up', name: 'All servers running', category: 'Servers' }] }) });
    }
    return Promise.resolve({ body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) } });
  });
});
afterEach(() => vi.clearAllMocks());

test('renders verdict bar and Run all button, loads catalog', async () => {
  render(<CheckPage />);
  expect(screen.getByRole('button', { name: /run all checks/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Servers')).toBeInTheDocument());
});
