// demo_api_ui/src/pages/__tests__/CheckPage.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CheckPage from '../CheckPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

vi.mock('../../services/bffAxios', () => ({
  default: {
    post: vi.fn(() =>
      Promise.resolve({ status: 200, data: { toolsCalled: ['get_balance'], finalMessage: 'ok' } }),
    ),
  },
}));

const CATALOG = {
  flags: {},
  checks: [
    { id: 'servers.all_up', name: 'All servers running', category: 'Servers' },
    { id: 'llm.status', name: 'LLM models', category: 'LLM' },
  ],
};

// A fetch Response whose body streams the given SSE frames, like /api/check/run.
function sseResponse(frames) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            i < frames.length
              ? { value: encoder.encode(frames[i++]), done: false }
              : { value: undefined, done: true },
          ),
      }),
    },
  };
}

// CheckPage reads the app's active vertical through useVertical, which needs a
// router (useLocation) and the vertical context.
function renderPage(activeId) {
  return render(
    <MemoryRouter initialEntries={['/check']}>
      <VerticalContext.Provider
        value={{
          activeId,
          pageManifest: null,
          pageMockData: null,
          adminManifest: null,
          isAdmin: false,
          refetch: () => {},
        }}
      >
        <CheckPage />
      </VerticalContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  globalThis.fetch = vi.fn((url) => {
    if (String(url).includes('/catalog')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOG) });
    }
    if (String(url).includes('/api/check/run')) {
      return Promise.resolve(
        sseResponse([
          'event: result\ndata: {"id":"servers.all_up","category":"Servers","status":"pass","detail":"12/12 required up"}\n\n',
          'event: result\ndata: {"id":"llm.status","category":"LLM","status":"pass","detail":"3 models"}\n\n',
          'event: done\ndata: {"verdict":"ready"}\n\n',
        ]),
      );
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});
afterEach(() => vi.clearAllMocks());

test('renders verdict bar and Run demo check button, loads catalog', async () => {
  renderPage('sporting-goods');
  expect(screen.getByRole('heading', { name: /demo check/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run demo check/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Servers')).toBeInTheDocument());
});

test('the targeted chip run merges into the full run — it does not clear categories it did not run', async () => {
  const user = userEvent.setup();
  renderPage('sporting-goods');
  await screen.findByText('Servers');

  await user.click(screen.getByRole('button', { name: /run demo check/i }));
  await waitFor(() => expect(screen.getByText('12/12 required up')).toBeInTheDocument());
  expect(screen.getByText('3 models')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /run real chip test/i }));
  await waitFor(() => expect(screen.getByText('End-to-End Chip')).toBeInTheDocument());

  // The point: the categories the chip test never ran keep their results.
  expect(screen.getByText('12/12 required up')).toBeInTheDocument();
  expect(screen.getByText('3 models')).toBeInTheDocument();
});

test('the vertical selector defaults to the vertical the app is actually on', async () => {
  renderPage('retail');
  await screen.findByText('Servers');
  expect(screen.getByRole('combobox')).toHaveValue('retail');
});

test('falls back to sporting-goods when no vertical is active', async () => {
  renderPage(null);
  await screen.findByText('Servers');
  expect(screen.getByRole('combobox')).toHaveValue('sporting-goods');
});

test('an operator pick wins over the active vertical', async () => {
  const user = userEvent.setup();
  renderPage('retail');
  await screen.findByText('Servers');
  await user.selectOptions(screen.getByRole('combobox'), 'healthcare');
  expect(screen.getByRole('combobox')).toHaveValue('healthcare');
});
