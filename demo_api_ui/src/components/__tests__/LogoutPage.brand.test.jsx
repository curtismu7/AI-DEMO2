// LogoutPage brand row — vertical logo replaces the 🔐 glyph on vertical pages.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { VerticalContext } from '../../vertical/VerticalProvider';
import LogoutPage from '../LogoutPage';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../services/bffAxios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
});

function renderWith(manifest) {
  return render(
    <VerticalContext.Provider value={{ pageManifest: manifest }}>
      <LogoutPage />
    </VerticalContext.Provider>,
  );
}

test('shows the vertical logo instead of the glyph when the vertical has one', () => {
  renderWith({
    id: 'airlines',
    identity: { displayName: 'United Airlines', logoPath: 'https://cdn.brandfetch.io/x/theme/light/logo.svg' },
  });
  expect(screen.getByAltText('United Airlines')).toHaveAttribute('src', 'https://cdn.brandfetch.io/x/theme/light/logo.svg');
  expect(screen.queryByText('🔐')).not.toBeInTheDocument();
});

test('keeps the glyph when there is no vertical logo', () => {
  renderWith({ identity: { displayName: 'Test' } });
  expect(screen.getByText('🔐')).toBeInTheDocument();
});
