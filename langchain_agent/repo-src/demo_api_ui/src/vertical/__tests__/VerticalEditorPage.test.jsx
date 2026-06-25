import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VerticalContext } from '../VerticalProvider';
import { VerticalEditorPage } from '../AdminEditor/VerticalEditorPage';

// Stub Monaco — we only test the page-level wiring, not Monaco internals.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }) => (
    <textarea
      data-testid="monaco"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const MIN = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: id },
});

function tree({ pageManifest, isAdmin = true }) {
  return (
    <MemoryRouter initialEntries={['/admin/verticals']}>
      <VerticalContext.Provider
        value={{
          activeId: pageManifest.id,
          pageManifest,
          pageMockData: {},
          adminManifest: MIN('admin-console'),
          isAdmin,
          refetch: jest.fn(),
        }}
      >
        <VerticalEditorPage />
      </VerticalContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  // Route by URL: the editor fetches /list (vertical list) AND /:id/seed (the
  // raw seed manifest that save() diffs against). Without a seedManifest,
  // seedValue stays '' and save()'s JSON.parse(seedValue) throws.
  global.fetch = jest.fn().mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/seed')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ seedManifest: MIN('banking'), overlayPaths: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ([
        { id: 'banking', displayName: 'Bank' },
        { id: 'healthcare', displayName: 'Health' },
      ]),
    });
  });
  global.confirm = jest.fn(() => true);
});

describe('VerticalEditorPage', () => {
  test('renders the active vertical in Monaco', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    const ta = await screen.findByTestId('monaco');
    expect(ta.value).toContain('"id": "banking"');
  });

  test('Save button posts batch overlay', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    const ta = await screen.findByTestId('monaco');
    const edited = JSON.parse(ta.value);
    edited.identity.tagline = 'NEW';
    fireEvent.change(ta, { target: { value: JSON.stringify(edited, null, 2) } });

    global.fetch.mockClear();
    global.fetch.mockResolvedValue({ ok: true, status: 204 });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/verticals/banking/overlay/batch'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('Delete button hidden for banking', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    await screen.findByTestId('monaco');
    expect(screen.queryByText('Delete')).toBeNull();
  });

  test('Delete button shown for non-protected id', async () => {
    render(tree({ pageManifest: MIN('test-clone') }));
    await screen.findByTestId('monaco');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('Save state button present for admin', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    await screen.findByTestId('monaco');
    expect(screen.getByText('Save state')).toBeInTheDocument();
  });

  test('Clone button opens modal', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    await screen.findByTestId('monaco');
    fireEvent.click(screen.getByText('+ Clone vertical'));
    expect(screen.getByText(/Clone vertical from banking/)).toBeInTheDocument();
  });
});
