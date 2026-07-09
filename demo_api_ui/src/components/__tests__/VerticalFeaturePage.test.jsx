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

test('featurePageOverride wins over vertical featurePage for invest chip', () => {
  renderWith({
    featurePayload: {
      invest: { portfolioId: 'INV-8842', holder: 'Jordan A. Rivera', totalValue: 184320.55 },
      apiKeyMaskedLast4: '0000',
      apiCall: 'GET /invest',
      message: 'Gateway swapped OAuth bearer for service API key.',
    },
    featurePageOverride: {
      pageTitle: 'Portfolio Status',
      badgeLabel: 'API-KEY PATH',
      dataKey: 'invest',
      fields: [
        { label: 'Portfolio ID', path: 'portfolioId' },
        { label: 'Holder', path: 'holder' },
        { label: 'Total value', path: 'totalValue', format: 'money', accent: true },
      ],
      sectionTitle: 'Portfolio details',
    },
  });
  expect(screen.getByText('Portfolio Status')).toBeInTheDocument();
  expect(screen.getByText('INV-8842')).toBeInTheDocument();
  expect(screen.getByText('Jordan A. Rivera')).toBeInTheDocument();
});
