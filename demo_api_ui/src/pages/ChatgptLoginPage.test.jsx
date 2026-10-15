import { fireEvent, render, screen } from '@testing-library/react';
import ChatgptLoginPage from './ChatgptLoginPage';
import { STEPS } from './chatgptLoginSteps';

describe('ChatgptLoginPage', () => {
  it('has the 12 numbered steps of the flow', () => {
    expect(STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('steps through the flow and shows the detail for the current step', () => {
    render(<ChatgptLoginPage />);
    expect(screen.getByText('Step 1 of 12')).toBeTruthy();
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Step 3 of 12')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Authentication required' })).toBeTruthy();
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText('Step 1 of 12')).toBeTruthy();
  });
});
