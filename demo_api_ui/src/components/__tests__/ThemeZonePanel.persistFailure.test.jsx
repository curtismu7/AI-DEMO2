// demo_api_ui/src/components/__tests__/ThemeZonePanel.persistFailure.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ThemeZonePanel from '../ThemeZonePanel';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ refetch: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    if (!opts) {
      // Initial GET /api/admin/vertical-themes
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    // PUT/DELETE persist call — server rejects
    return Promise.resolve({ ok: false, status: 500 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('finding #51: does not show a success toast when the server rejects the save', async () => {
  render(<ThemeZonePanel verticalId="banking" />);

  const group = await screen.findByRole('group', { name: 'Header gradient' });
  const swatchButton = group.querySelector('button.tzp-swatch:not(.tzp-swatch--reset)');
  fireEvent.click(swatchButton);

  await waitFor(() => expect(fetch).toHaveBeenCalledWith(
    '/api/admin/vertical-themes/banking',
    expect.objectContaining({ method: 'PUT' })
  ));

  // Give the rejected persist() promise's .catch a tick to run (or not run setToast).
  await new Promise((r) => setTimeout(r, 20));

  expect(screen.queryByRole('status')).toBeNull();
});
