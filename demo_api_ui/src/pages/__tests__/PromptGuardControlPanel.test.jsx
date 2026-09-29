import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PromptGuardControlPanel from '../PromptGuardControlPanel';

const STORAGE_KEY = 'promptguard-sidecar-config-draft';
const DEFAULT_CONFIG = {
  engine: 'classifier',
  demo: { enabled: false, triggerPhrase: '', outcome: 'block' },
};
const SAVED_CONFIG = {
  engine: 'nemo',
  demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'allow' },
};
const ENGINES = [
  { id: 'classifier', available: true, reason: null },
  { id: 'nemo', available: false, reason: 'optional_dependency_missing' },
];
const response = (data, status = 200) => ({
  ok: status < 400, status, json: async () => data,
});

// Only the external HTTP boundary is mocked; the component, controls and storage are real.
function mockSidecarFetch({ engines = ENGINES, disconnectedPath, putError, refreshedConfig, appliedConfig, configFailureAfterPut } = {}) {
  let active = structuredClone(DEFAULT_CONFIG);
  let applied = false;
  const fetchMock = vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === disconnectedPath) throw new Error('Connection refused');
    if (path === '/health') return response({ ok: true });
    if (path === '/demo/config') {
      if (options.method === 'PUT') {
        if (putError) return response(putError, 400);
        active = appliedConfig || JSON.parse(options.body);
        applied = true;
      } else if (applied) {
        if (configFailureAfterPut) throw new Error('Connection refused after Apply');
        if (refreshedConfig) active = refreshedConfig;
      }
      return response({ config: active, engines });
    }
    throw new Error(`Unexpected sidecar URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function connectedPanel() {
  render(<PromptGuardControlPanel />);
  await screen.findByText('Connected');
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('loads the built-in detector with demo overrides off and explains unavailable NeMo', async () => {
  mockSidecarFetch();
  await connectedPanel();
  expect(screen.getByLabelText('Detector')).toHaveValue('classifier');
  expect(screen.getByRole('option', { name: 'NeMo Guardrails' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Demo override' })).not.toBeChecked();
  expect(screen.getByText(/optional_dependency_missing/)).toBeInTheDocument();
  expect(screen.getByText(/PROMPTGUARD_INSTALL_NEMO=1/)).toBeInTheDocument();
});

it.each(['/health', '/demo/config'])('keeps a saved draft when %s disconnects', async (disconnectedPath) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED_CONFIG));
  const fetchMock = mockSidecarFetch({ disconnectedPath });
  render(<PromptGuardControlPanel />);
  await screen.findByText('Disconnected');
  expect(screen.getByLabelText('Literal trigger phrase')).toHaveValue('DEMO_TRIGGER');
  expect(screen.getByRole('switch', { name: 'Demo override' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(screen.getByText(/local port-forward is not responding/i)).toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(SAVED_CONFIG));
  expect(fetchMock.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
});

it('restores a saved draft separately from active shared state without auto-applying it', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED_CONFIG));
  const fetchMock = mockSidecarFetch({ engines: ENGINES.map((engine) => ({ ...engine, available: true, reason: null })) });
  await connectedPanel();
  expect(screen.getByLabelText('Detector')).toHaveValue('nemo');
  expect(screen.getByLabelText('Outcome')).toHaveValue('allow');
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Built-in classifier.*Demo override disabled/);
  expect(fetchMock.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
});

it('applies the exact NeMo config with omitted credentials and refreshes active state from GET', async () => {
  const fetchMock = mockSidecarFetch({
    engines: ENGINES.map((engine) => ({ ...engine, available: true, reason: null })),
    refreshedConfig: { ...SAVED_CONFIG, demo: { ...SAVED_CONFIG.demo, outcome: 'block' } },
  });
  await connectedPanel();
  fireEvent.change(screen.getByLabelText('Detector'), { target: { value: 'nemo' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'DEMO_TRIGGER' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText(/Configuration applied/);
  expect(fetchMock).toHaveBeenCalledWith('http://localhost:8086/demo/config', expect.objectContaining({
    method: 'PUT', mode: 'cors', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: 'nemo', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' } }),
  }));
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/NeMo Guardrails.*block.*DEMO_TRIGGER/);
  const putIndex = fetchMock.mock.calls.findIndex(([, options]) => options.method === 'PUT');
  expect(fetchMock.mock.calls[putIndex + 1]).toEqual(['http://localhost:8086/demo/config', expect.objectContaining({ method: 'GET' })]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
    engine: 'nemo', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' },
  });
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).toMatch(/^http:\/\/localhost:8086\/(health|demo\/config)$/);
    expect(options).toMatchObject({ mode: 'cors', credentials: 'omit' });
    expect(options.headers?.Authorization).toBeUndefined();
  }
});

it('uses the GET result rather than assuming the PUT result is still the shared state', async () => {
  mockSidecarFetch({ refreshedConfig: SAVED_CONFIG });
  await connectedPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText(/Configuration applied/);
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/NeMo Guardrails.*allow.*DEMO_TRIGGER/);
  expect(screen.getByLabelText('Detector')).toHaveValue('classifier');
});

it('preserves the edited draft and previous saved values on a server validation error', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CONFIG));
  mockSidecarFetch({ putError: { error: 'invalid_config', message: 'Trigger phrase must be valid' } });
  await connectedPanel();
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'EDITED_TRIGGER' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Trigger phrase must be valid');
  expect(screen.getByLabelText('Literal trigger phrase')).toHaveValue('EDITED_TRIGGER');
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Demo override disabled/);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_CONFIG));
});

it('prevents Apply for blank enabled phrases or phrases over 120 characters', async () => {
  mockSidecarFetch();
  await connectedPanel();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(screen.getByText(/Enter a trigger phrase/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'x'.repeat(121) } });
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(screen.getByText(/120 characters/)).toBeInTheDocument();
});

it('prevents applying an unavailable saved NeMo draft and permits switching to the classifier', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED_CONFIG));
  mockSidecarFetch();
  await connectedPanel();
  expect(screen.getByRole('option', { name: 'NeMo Guardrails' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Detector'), { target: { value: 'classifier' } });
  expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
});

it('ignores malformed browser storage and does not persist merely loading active config', async () => {
  localStorage.setItem(STORAGE_KEY, '{bad JSON');
  mockSidecarFetch();
  await connectedPanel();
  expect(screen.getByLabelText('Detector')).toHaveValue('classifier');
  expect(localStorage.getItem(STORAGE_KEY)).toBe('{bad JSON');
});

it('aborts outstanding mount requests when unmounted', () => {
  const fetchMock = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(<PromptGuardControlPanel />);
  const signals = fetchMock.mock.calls.map(([, options]) => options.signal);
  unmount();
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal?.aborted)).toBe(true);
});


it('saves the successfully applied normalized config rather than the untrimmed request draft', async () => {
  mockSidecarFetch({ appliedConfig: {
    engine: 'classifier', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' },
  } });
  await connectedPanel();
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: '  DEMO_TRIGGER  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText(/Configuration applied/);
  expect(screen.getByLabelText('Literal trigger phrase')).toHaveValue('DEMO_TRIGGER');
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
    engine: 'classifier', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' },
  });
});

it('reports an unconfirmed Apply when its followup GET fails without replacing the saved draft', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CONFIG));
  mockSidecarFetch({ configFailureAfterPut: true });
  await connectedPanel();
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'DEMO_TRIGGER' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Apply was sent.*could not be refreshed/);
  expect(screen.getByText('Disconnected')).toBeInTheDocument();
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Last observed/);
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_CONFIG));
});
