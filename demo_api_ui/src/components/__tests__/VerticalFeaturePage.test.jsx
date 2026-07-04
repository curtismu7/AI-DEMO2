// VerticalFeaturePage.test.jsx
// Task 5 Part A — TDD test for the API-call row in the credential-swap card.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerticalFeaturePage from '../VerticalFeaturePage';

function renderWith(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/feature', state }]}>
      <VerticalFeaturePage />
    </MemoryRouter>
  );
}

test('shows the API call row in the credential-swap card', () => {
  renderWith({ featurePayload: { apiKeyMaskedLast4: '0000', apiCall: 'GET /invest', backend: { authMechanism: 'X-API-Key (shared secret)' } } });
  expect(screen.getByText(/GET \/invest/)).toBeInTheDocument();
  expect(screen.getByText(/0000/)).toBeInTheDocument();
});
