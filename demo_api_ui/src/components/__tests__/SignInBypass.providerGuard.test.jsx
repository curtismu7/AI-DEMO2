/**
 * PingOneProviderGuard — "Continue to PingOne" opens the branded pi.flow modal
 * via openSignIn; it never redirects straight to a BFF login URL.
 */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PI_FLOW_SIGNIN_EVENT } from '../../utils/authUi';
import PingOneProviderGuard from '../PingOneProviderGuard';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    post: vi.fn(() => Promise.resolve({ data: {} })),
    get: vi.fn(() => Promise.resolve({ data: { authenticated: true, loginProvider: 'pingfederate' } })),
  },
}));

vi.mock('../../services/oauthSessionService', () => ({
  __esModule: true,
  default: { get: vi.fn(() => Promise.resolve({ data: { authenticated: false } })), check: vi.fn(() => Promise.resolve({ authenticated: false })) },
}));

vi.mock('../../utils/idJagRunMode', () => ({
  __esModule: true,
  clearIdJagRunStateForProviderSwitch: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../DraggableModal', () => ({
  __esModule: true,
  default: ({ children, footer, title }) => (
    <div>
      <div>{title}</div>
      {footer}
      <div>{children}</div>
    </div>
  ),
}));

describe('PingOneProviderGuard switch', () => {
  let handled;
  beforeEach(() => {
    handled = vi.fn((e) => { e.detail.handled = true; });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign: vi.fn() },
    });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });

  test('"Continue to PingOne" opens the modal, not a redirect', async () => {
    render(<PingOneProviderGuard returnTo="/dashboard" />);
    fireEvent.click(await screen.findByRole('button', { name: /continue to pingone/i }));
    await waitFor(() => expect(handled).toHaveBeenCalled());
    expect(window.location.href).toBe('');
  });
});
