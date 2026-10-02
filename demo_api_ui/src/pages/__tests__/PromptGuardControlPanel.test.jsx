import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import PromptGuardControlPanel from '../PromptGuardControlPanel';

const STORAGE_KEY = 'promptguard-sidecar-config-draft';
const DEFAULT_CONFIG = {
  engine: 'classifier',
  demo: { enabled: false, triggerPhrase: '', outcome: 'block' },
};
const DEFAULT_RAILS = { injection: true, regex_pii: false, presidio_pii: false };
const RAILS = [
  { id: 'injection', label: 'Prompt injection (classifier)', directions: ['request', 'response'], available: true, reason: null },
  { id: 'regex_pii', label: 'PII patterns (regex)', directions: ['request', 'response'], available: true, reason: null },
  { id: 'presidio_pii', label: 'PII entities (Presidio)', directions: ['request', 'response'], available: false, reason: 'Presidio is not installed' },
];
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('refreshes engine readiness after a rejected NeMo activation while retaining edited and saved drafts', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CONFIG));
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (options.method === 'PUT') {
      failed = true;
      return response({ error: 'engine_unavailable', message: 'NeMo initialization failed' }, 409);
    }
    if (url.endsWith('/health')) return response({ ok: true });
    return response({ config: DEFAULT_CONFIG, engines: failed ? ENGINES
      : ENGINES.map((engine) => ({ ...engine, available: true, reason: null })) });
  }));
  await connectedPanel();
  fireEvent.change(screen.getByLabelText('Detector'), { target: { value: 'nemo' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Demo override' }));
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'EDITED_TRIGGER' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('NeMo initialization failed');
  expect(screen.getByRole('option', { name: 'NeMo Guardrails' })).toBeDisabled();
  expect(screen.queryByText('NeMo Guardrails is ready.')).not.toBeInTheDocument();
  expect(screen.getByText(/optional_dependency_missing/)).toBeInTheDocument();
  expect(screen.getByLabelText('Detector')).toHaveValue('nemo');
  expect(screen.getByLabelText('Literal trigger phrase')).toHaveValue('EDITED_TRIGGER');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_CONFIG));
});

it('refreshes an open panel across tunnel outage and sidecar restart without applying its draft', async () => {
  vi.useFakeTimers();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED_CONFIG));
  let outage = false;
  let active = SAVED_CONFIG;
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (options.method === 'PUT') throw new Error('Refresh must not apply config');
    if (outage) throw new Error('Tunnel unavailable');
    return response(url.endsWith('/health') ? { ok: true } : { config: active, engines: ENGINES });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(<PromptGuardControlPanel />);
  await act(async () => {});
  expect(screen.getByText('Connected')).toBeInTheDocument();
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Demo override allow/);
  fireEvent.change(screen.getByLabelText('Literal trigger phrase'), { target: { value: 'UNSAVED_EDIT' } });
  outage = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByText('Disconnected')).toBeInTheDocument();
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Last observed/);
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  outage = false;
  active = DEFAULT_CONFIG;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByText('Connected')).toBeInTheDocument();
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Built-in classifier.*Demo override disabled/);
  expect(screen.getByLabelText('Literal trigger phrase')).toHaveValue('UNSAVED_EDIT');
  expect(screen.getByLabelText('Detector')).toHaveValue('nemo');
  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(SAVED_CONFIG));
  expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  const requestCount = fetchMock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetchMock.mock.calls).toHaveLength(requestCount);
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
    body: JSON.stringify({ engine: 'nemo', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' }, rails: DEFAULT_RAILS }),
  }));
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/NeMo Guardrails.*block.*DEMO_TRIGGER/);
  const putIndex = fetchMock.mock.calls.findIndex(([, options]) => options.method === 'PUT');
  expect(fetchMock.mock.calls[putIndex + 1]).toEqual(['http://localhost:8086/demo/config', expect.objectContaining({ method: 'GET' })]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
    engine: 'nemo', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' }, rails: DEFAULT_RAILS,
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
  vi.useFakeTimers();
  const fetchMock = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(<PromptGuardControlPanel />);
  const signals = fetchMock.mock.calls.map(([, options]) => options.signal);
  unmount();
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal?.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
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
    engine: 'classifier', demo: { enabled: true, triggerPhrase: 'DEMO_TRIGGER', outcome: 'block' }, rails: DEFAULT_RAILS,
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

function mockRailsSidecar() {
  let active = { ...structuredClone(DEFAULT_CONFIG), rails: { ...DEFAULT_RAILS } };
  const engines = ENGINES.map((engine) => ({ ...engine, available: true, reason: null }));
  const fetchMock = vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/health') return response({ ok: true });
    if (path === '/inspect') {
      const unit = JSON.parse(options.body).units[0];
      return { ok: true, status: 200, headers: { get: () => 'nemo' },
        json: async () => ({ findings: unit.direction === 'response'
          ? [{ category: 'pii', severity: 'high', messages: ['Prompt-Guard flagged PII (rails: regex_pii)'] }] : [] }) };
    }
    if (options.method === 'PUT') active = JSON.parse(options.body);
    return response({ config: active, engines, rails: RAILS });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('lists every rail, disables unavailable ones, and keeps rails off until NeMo is selected', async () => {
  mockRailsSidecar();
  await connectedPanel();
  const injection = screen.getByRole('checkbox', { name: 'Prompt injection (classifier)' });
  const regex = screen.getByRole('checkbox', { name: 'PII patterns (regex)' });
  expect(injection).toBeChecked();
  expect(regex).not.toBeChecked();
  expect(regex).toBeDisabled();
  expect(screen.getByText(/Rails run on the NeMo Guardrails detector only/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Detector'), { target: { value: 'nemo' } });
  expect(regex).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'PII entities (Presidio)' })).toBeDisabled();
  expect(screen.getByText(/Unavailable: Presidio is not installed/)).toBeInTheDocument();
});

it('sends the toggled rails on Apply and reports them in the active state', async () => {
  const fetchMock = mockRailsSidecar();
  await connectedPanel();
  fireEvent.change(screen.getByLabelText('Detector'), { target: { value: 'nemo' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'PII patterns (regex)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText(/Configuration applied/);
  const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(put[1].body).rails).toEqual({ injection: true, regex_pii: true, presidio_pii: false });
  expect(screen.getByLabelText('Active shared sidecar state')).toHaveTextContent(/Rails: Prompt injection \(classifier\), PII patterns \(regex\)\./);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).rails.regex_pii).toBe(true);
});

it('inspects text as a model reply when the direction is switched to response', async () => {
  const fetchMock = mockRailsSidecar();
  await connectedPanel();
  fireEvent.change(screen.getByLabelText('Text direction'), { target: { value: 'response' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check prompt' }));
  expect(await screen.findByText('Flagged')).toBeInTheDocument();
  expect(screen.getByText(/rails: regex_pii/)).toBeInTheDocument();
  const inspect = fetchMock.mock.calls.find(([url]) => url.endsWith('/inspect'));
  expect(JSON.parse(inspect[1].body).units[0]).toMatchObject({ role: 'user_prompt', direction: 'response' });
});
