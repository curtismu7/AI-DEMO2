// The nav switcher must render for a signed-out visitor: GET /verticals/list
// and POST /verticals/active are both public, and TopNav places the switcher
// "visible to everyone (guests too) so the demo flow can be tailored before
// sign-in". An auth gate here used to hide it from exactly that visitor.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerticalSwitcher from '../VerticalSwitcher';

describe('VerticalSwitcher — signed out', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) =>
      String(url).includes('/api/verticals/list')
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              { id: 'banking', displayName: 'Super Banking' },
              { id: 'sporting-goods', displayName: 'Super Sports' },
            ]),
          })
        : Promise.reject(new Error(`unexpected fetch: ${url}`)),
    );
  });

  it('lists verticals with no session — no auth event, no auth status call', async () => {
    render(<MemoryRouter><VerticalSwitcher variant="nav" /></MemoryRouter>);

    expect(await screen.findByRole('option', { name: 'Super Sports' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /switch demo vertical/i })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
