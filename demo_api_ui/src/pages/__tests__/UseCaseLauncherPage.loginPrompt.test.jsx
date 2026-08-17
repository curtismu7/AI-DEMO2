/**
 * The launcher turns the BFF's "you need to sign in" refusal into a button.
 *
 * `/api/use-cases/demo/run` answers a caller who lacks the level with
 * { requiresLogin, requiredAuth, message }. Shipped in #1952 with no test —
 * this pins that the refusal renders as an actionable control (and which one),
 * rather than a dead error string on a page whose only fix is a sign-in.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

const navigateToCustomerOAuthLogin = vi.fn();
const navigateToAdminOAuthLogin = vi.fn();
vi.mock('../../utils/authUi', () => ({
  navigateToCustomerOAuthLogin: (...a) => navigateToCustomerOAuthLogin(...a),
  navigateToAdminOAuthLogin: (...a) => navigateToAdminOAuthLogin(...a),
}));

import { ChipLoginPrompt } from '../UseCaseLauncherPage';

beforeEach(() => {
  navigateToCustomerOAuthLogin.mockReset();
  navigateToAdminOAuthLogin.mockReset();
});

describe('ChipLoginPrompt', () => {
  it('renders nothing when the step was not refused', () => {
    const { container } = render(<ChipLoginPrompt prompt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the message and a customer sign-in for a user-level refusal', () => {
    render(<ChipLoginPrompt prompt={{ msg: 'This step needs you signed in.', loginAs: 'user' }} />);

    expect(screen.getByText(/This step needs you signed in\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(navigateToCustomerOAuthLogin).toHaveBeenCalledTimes(1);
    expect(navigateToAdminOAuthLogin).not.toHaveBeenCalled();
  });

  // A customer login cannot satisfy an admin step, so offering one would send
  // the visitor through OAuth only to be refused again on return.
  it('sends an admin-level refusal to the ADMIN login', () => {
    render(<ChipLoginPrompt prompt={{ msg: 'This step needs an admin sign-in.', loginAs: 'admin' }} />);

    fireEvent.click(screen.getByRole('button', { name: /sign in as admin/i }));
    expect(navigateToAdminOAuthLogin).toHaveBeenCalledTimes(1);
    expect(navigateToCustomerOAuthLogin).not.toHaveBeenCalled();
  });
});
