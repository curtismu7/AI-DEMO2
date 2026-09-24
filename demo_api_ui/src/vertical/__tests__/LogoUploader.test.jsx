// demo_api_ui/src/vertical/__tests__/LogoUploader.test.jsx
// Vitest — LogoUploader probes the T3 endpoints and reports errors via toast.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.delete },
}));

vi.mock('../../utils/appToast', () => ({
  notifySuccess: mocks.notifySuccess,
  notifyError: mocks.notifyError,
}));

import LogoUploader from '../AdminEditor/LogoUploader';

beforeEach(() => {
  vi.clearAllMocks();
  // Default probe result: no logo yet (individual tests override).
  mocks.get.mockRejectedValue({ response: { status: 404 } });
});

describe('LogoUploader', () => {
  it('shows the empty state when GET /logo 404s', async () => {
    mocks.get.mockRejectedValueOnce({ response: { status: 404 } });
    render(<LogoUploader verticalId="banking" />);
    await waitFor(() => expect(screen.getByText('No uploaded logo')).toBeTruthy());
    expect(mocks.get).toHaveBeenCalledWith('/api/verticals/banking/logo', { responseType: 'blob' });
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('uploads via POST /logo and calls onLogoChanged', async () => {
    mocks.post.mockResolvedValueOnce({ data: { ok: true } });
    const onLogoChanged = vi.fn();
    render(<LogoUploader verticalId="banking" onLogoChanged={onLogoChanged} />);
    await waitFor(() => expect(screen.getByText('Upload logo')).toBeTruthy());
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0][0]).toBe('/api/verticals/banking/logo');
    expect(onLogoChanged).toHaveBeenCalled();
    expect(mocks.notifySuccess).toHaveBeenCalledWith('Logo uploaded');
  });

  it('rejects a disallowed file type client-side without hitting the API', async () => {
    render(<LogoUploader verticalId="banking" />);
    await waitFor(() => expect(screen.getByText('Upload logo')).toBeTruthy());
    const file = new File(['x'], 'logo.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('Logo must be PNG, JPEG, SVG, or WebP'));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('Remove button issues DELETE /logo', async () => {
    mocks.get.mockResolvedValueOnce({ data: new Blob(['x'], { type: 'image/png' }) });
    mocks.delete.mockResolvedValueOnce({ data: {} });
    render(<LogoUploader verticalId="banking" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove uploaded logo' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove uploaded logo' }));
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/api/verticals/banking/logo'));
    expect(mocks.notifySuccess).toHaveBeenCalled();
  });
});
