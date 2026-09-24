// demo_api_ui/src/vertical/__tests__/SkinStudioPage.test.jsx
// Vitest — Skin Studio: vertical selection, tabs, logo uploader wiring, and
// duplicate flow. apiClient and useVertical are mocked; the T3/T5 endpoints
// are asserted by URL so the page cannot silently target the wrong surface.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  default: { get: mocks.get, post: mocks.post, put: mocks.put, delete: mocks.delete },
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ refetch: mocks.refetch }),
}));

vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('../../components/ThemeZonePanel', () => ({
  default: ({ verticalId }) => <div data-testid="zone-panel">{verticalId}</div>,
}));

import SkinStudioPage from '../../pages/SkinStudioPage';

const VERTICALS = [{ id: 'banking', displayName: 'Super Bank' }, { id: 'retail', displayName: 'Retail' }];

function setup() {
  mocks.get.mockImplementation((url) => {
    if (url === '/api/verticals/list') return Promise.resolve({ data: VERTICALS });
    if (url.includes('/logo')) return Promise.reject({ response: { status: 404 } });
    return Promise.resolve({ data: {} });
  });
  return render(<SkinStudioPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SkinStudioPage', () => {
  it('loads verticals, selects the first, and renders the Theme tab by default', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Theme' })).toBeTruthy());
    // First vertical selected
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Theme');
    const panel = screen.getByTestId('zone-panel');
    expect(panel.textContent).toBe('banking');
  });

  it('switching verticals re-targets the zone panel', async () => {
    setup();
    await waitFor(() => screen.getByRole('button', { name: 'Retail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retail' }));
    expect(screen.getByTestId('zone-panel').textContent).toBe('retail');
  });

  it('Duplicate tab: submits clone with cloneOverlay/cloneTheme', async () => {
    mocks.post.mockResolvedValueOnce({ data: { id: 'banking-copy' } });
    setup();
    await waitFor(() => screen.getByRole('tab', { name: 'Duplicate' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Duplicate' }));

    fireEvent.change(screen.getByPlaceholderText('e.g. banking-copy'), { target: { value: 'banking-copy' } });
    fireEvent.change(screen.getByPlaceholderText('Super Bank copy'), { target: { value: 'Bank Copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      '/api/verticals/banking/clone',
      { newId: 'banking-copy', displayName: 'Bank Copy', cloneOverlay: true, cloneTheme: true },
    ));
  });

  it('Duplicate tab: rejects an id that already exists client-side without calling the API', async () => {
    setup();
    await waitFor(() => screen.getByRole('tab', { name: 'Duplicate' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Duplicate' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. banking-copy'), { target: { value: 'retail' } });
    fireEvent.change(screen.getByPlaceholderText('Super Bank copy'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    // Status message appears (there is also a static field hint with the same text)
    await waitFor(() => expect(screen.getAllByText('id already exists').length).toBeGreaterThanOrEqual(1));
    const cloneCalls = mocks.post.mock.calls.filter((c) => String(c[0]).includes('/clone'));
    expect(cloneCalls.length).toBe(0);
  });

  it('Duplicate tab: surfaces the server error when the clone fails', async () => {
    mocks.post.mockRejectedValueOnce({ response: { data: { error: 'id already exists' } } });
    setup();
    await waitFor(() => screen.getByRole('tab', { name: 'Duplicate' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Duplicate' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. banking-copy'), { target: { value: 'new-one' } });
    fireEvent.change(screen.getByPlaceholderText('Super Bank copy'), { target: { value: 'New One' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.getByText('id already exists')).toBeTruthy());
  });

  it('Logo tab mounts the LogoUploader targeting the T3 endpoints', async () => {
    setup();
    await waitFor(() => screen.getByRole('tab', { name: 'Logo' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Logo' }));
    // LogoUploader probes GET /logo on mount
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/verticals/banking/logo', { responseType: 'blob' }));
    expect(screen.getByText('No uploaded logo')).toBeTruthy();
  });
});
