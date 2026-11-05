import { fireEvent, render, screen } from '@testing-library/react';
import SignInPrompt from '../SignInPrompt';
import { PI_FLOW_SIGNIN_EVENT } from '../../utils/authUi';

// The "Sign in required" card must bring the user back to the page they were on, ?query included
// (live: /group-policy?verticalId=government signed in and came back as /group-policy).
test('Sign in carries the current path and query to the sign-in flow', () => {
  window.history.pushState({}, '', '/group-policy?verticalId=government');
  const seen = [];
  const on = (e) => { seen.push(e.detail.returnTo); e.detail.handled = true; };
  window.addEventListener(PI_FLOW_SIGNIN_EVENT, on);
  render(<SignInPrompt />);
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  window.removeEventListener(PI_FLOW_SIGNIN_EVENT, on);
  expect(seen).toEqual(['/group-policy?verticalId=government']);
});
