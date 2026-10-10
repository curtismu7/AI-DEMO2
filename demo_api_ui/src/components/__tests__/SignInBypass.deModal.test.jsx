/**
 * PingFederateDownModal — its "Sign in with PingOne" recovery opens the branded
 * pi.flow modal via openSignIn; it never redirects straight to a BFF login URL.
 */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PI_FLOW_SIGNIN_EVENT } from '../../utils/authUi';
import PingFederateDownModal from '../PingFederateDownModal';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { post: vi.fn(() => Promise.resolve({})), get: vi.fn(() => Promise.resolve({})) },
}));

const PF_UNREACHABLE = 'pingfederate_unreachable';

describe('PingFederateDownModal recovery', () => {
  let handled;
  beforeEach(() => {
    handled = vi.fn((e) => { e.detail.handled = true; });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://app.test', pathname: '/dashboard', href: '', assign: vi.fn(),
        search: `?idp_error=${PF_UNREACHABLE}`,
      },
    });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });

  test('"Sign in with PingOne" opens the modal, not a redirect', async () => {
    render(<PingFederateDownModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with PingOne' }));
    await waitFor(() => expect(handled).toHaveBeenCalled());
    expect(window.location.href).toBe('');
  });
});
