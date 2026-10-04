// While transactions load, the page keeps the boot skeleton on screen (AuthLoadingScreen)
// instead of swapping to a small spinner on a near-white page, which flashed on refresh.
import React from 'react';
import { render, screen } from '@testing-library/react';
import UserTransactions from '../components/UserTransactions';

describe('UserTransactions loading state', () => {
  it('shows the continuous skeleton loading screen', () => {
    const { container } = render(<UserTransactions user={{ role: 'customer' }} />);
    expect(container.querySelector('.main-content--auth-loading .boot-skeleton')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Loading your transactions…' })).toBeInTheDocument();
  });
});
