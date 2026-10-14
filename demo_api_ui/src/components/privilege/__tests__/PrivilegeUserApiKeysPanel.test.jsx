import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivilegeMcpClientPage from '../../../pages/PrivilegeMcpClientPage';
import apiClient from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  global.EventSource = class { addEventListener() {} close() {} };
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => vi.unstubAllGlobals());

it('includes User API Key & Secrets in Demo and preserves Inspect tabs', () => {
  render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);
  expect([...document.querySelectorAll('.cur-tab')].map(tab => tab.textContent))
    .toEqual(['Agent Chat', 'Tools', 'User API Key & Secrets']);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
  expect([...document.querySelectorAll('.cur-tab')].map(tab => tab.textContent))
    .toEqual(['MCP Explorer', 'Raw RPC', 'Policies']);
});

const STATUS = {
  apiKeySet: true, apiSecretSet: true,
  apiKeyPreview: 'key1••••••••key9', apiSecretPreview: 'sec1••••••••sec9',
  missingEntries: [], controllerUrl: 'https://privilege.test-one-pingone.com',
};
const ENV = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CONFIG = { _skipTrafficCapture: true, headers: { 'x-privilege-user-api-csrf': '1' } };
const RUN_CONFIG = { ...CONFIG, timeout: 25000 };
async function panel() {
  const { default: Panel } = await import('../PrivilegeUserApiKeysPanel');
  apiClient.get.mockResolvedValue({ data: STATUS });
  const rendered = render(<Panel />);
  await screen.findByText(STATUS.apiKeyPreview);
  return { ...rendered, Panel };
}
const field = name => screen.getByLabelText(name);
const change = (name, value) => fireEvent.change(field(name), { target: { value } });
function ids() { change('Environment ID', ENV); change('User ID', USER); }
const run = () => fireEvent.click(screen.getByRole('button', { name: 'Run token and list users' }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save to Vault' }));

it('loads masked vault status without prefilling or revealing credentials', async () => {
  await panel();
  expect(apiClient.get).toHaveBeenCalledWith('/api/privilege-user-api-keys/status', { _skipTrafficCapture: true });
  for (const label of ['API key', 'API secret', 'Current vault password']) {
    expect(field(label)).toHaveValue('');
    expect(field(label)).toHaveAttribute('type', 'password');
  }
  expect(screen.getByText(STATUS.apiSecretPreview)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reveal|show.*jwt/i })).toBeNull();
});

it.each([['API key', 'api_key'], ['API secret', 'api_secret']])('replaces %s independently and clears every editor input on success', async (label, key) => {
  await panel();
  apiClient.post.mockResolvedValue({ data: { ...STATUS, apiKeyPreview: 'new1••••••••new9' } });
  change(label, 'replacement'); change('Current vault password', 'vault-password');
  save();
  await screen.findByText('Credentials saved to vault.');
  expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-user-api-keys/credentials', { [key]: 'replacement', current_password: 'vault-password' }, CONFIG);
  for (const name of ['API key', 'API secret', 'Current vault password']) expect(field(name)).toHaveValue('');
  expect(screen.getByText('new1••••••••new9')).toBeInTheDocument();
});

it('clears every input on failed save and never renders raw exception diagnostics', async () => {
  await panel();
  apiClient.post.mockRejectedValue({ response: { status: 401, data: { code: 'VAULT_AUTH_FAILED', error: 'vault-password raw-secret' } }, message: 'raw-secret' });
  change('API key', 'raw-key'); change('API secret', 'raw-secret'); change('Current vault password', 'vault-password');
  save();
  await screen.findByText('Unable to unlock the vault.');
  for (const name of ['API key', 'API secret', 'Current vault password']) expect(field(name)).toHaveValue('');
  expect(document.body.textContent).not.toContain('raw-secret');
  expect(document.body.textContent).not.toContain('vault-password');
});

it('rejects an empty save locally and clears its password', async () => {
  await panel(); change('Current vault password', 'vault-password'); save();
  expect(screen.getByRole('alert')).toHaveTextContent('Provide an API key or API secret.');
  expect(field('Current vault password')).toHaveValue('');
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('reports missing vault entries and prevents running without both', async () => {
  const { default: Panel } = await import('../PrivilegeUserApiKeysPanel');
  apiClient.get.mockResolvedValue({ data: { ...STATUS, apiSecretSet: false, apiSecretPreview: '', missingEntries: ['PRIVILEGE_USER_API_SECRET'] } });
  render(<Panel />);
  await screen.findByText(/PRIVILEGE_USER_API_SECRET/);
  expect(screen.getByRole('button', { name: 'Run token and list users' })).toBeDisabled();
});

it.each([['Environment ID', 'not-a-uuid'], ['User ID', 'name@example.com']])('validates %s before a run', async (label, value) => {
  await panel(); ids(); change(label, value); run();
  expect(screen.getByRole('alert')).toHaveTextContent(`${label} must be a UUID`);
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('shows four masked command shapes, pending progress and completed statuses', async () => {
  await panel();
  let resolve;
  apiClient.post.mockReturnValue(new Promise(done => { resolve = done; }));
  ids(); run();
  const progress = screen.getByRole('list', { name: 'Token flow progress' });
  for (const name of ['Encryption', 'Token request', 'Decryption', 'Users list']) expect(within(progress).getByText(new RegExp(name))).toBeInTheDocument();
  expect(progress).toHaveTextContent('Awaiting server result');
  expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
  const commands = screen.getByRole('list', { name: 'PDF commands' });
  expect(commands).toHaveTextContent('go run main.go encrypt');
  expect(commands).toHaveTextContent('go run main.go decrypt "<ENC_RES_DATA>"');
  expect(commands).toHaveTextContent('/pubapi/<ENVIRONMENT_ID>/v1/appusertoken');
  expect(commands).toHaveTextContent('/api/<ENVIRONMENT_ID>/v1/users');
  expect(commands).toHaveTextContent('Bearer <JWT>');
  expect(commands).not.toHaveTextContent(ENV);
  await act(async () => resolve({ data: { ok: true, httpStatus: 200, jwtPreview: 'abcd****wxyz', stages: [
    { stage: 'encryption', status: 'success' }, { stage: 'token-request', status: 'success', httpStatus: 200 },
    { stage: 'decryption', status: 'success' }, { stage: 'users-list', status: 'success', httpStatus: 200 },
  ], users: { users: [{ name: 'Demo user' }] } } }));
  expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-user-api-keys/run', { environment_id: ENV, user_id: USER }, RUN_CONFIG);
  expect(progress).toHaveTextContent('Encryption: Complete');
  expect(progress).toHaveTextContent('Token request: Complete');
  expect(progress).toHaveTextContent('Decryption: Complete');
  expect(progress).toHaveTextContent('Users list: Complete');
  expect(screen.getByText(/JWT preview: abcd\*\*\*\*wxyz/)).toBeInTheDocument();
  expect(screen.getByText('Demo user', { exact: false })).toBeInTheDocument();
});

it('renders sanitized failure stages and HTTP status without exception messages or stale users', async () => {
  await panel(); ids();
  apiClient.post.mockResolvedValue({ data: { ok: false, httpStatus: 401, code: 'UPSTREAM_HTTP_ERROR', error: 'Bearer raw.jwt.secret', stages: [
    { stage: 'encryption', status: 'success' }, { stage: 'token-request', status: 'success', httpStatus: 200 },
    { stage: 'decryption', status: 'success' }, { stage: 'users-list', status: 'error', httpStatus: 401 },
  ] } });
  run();
  await screen.findByText(/Privilege rejected the JWT/);
  expect(screen.getByRole('list', { name: 'Token flow progress' })).toHaveTextContent('Users list: Failed · HTTP 401');
  expect(document.body.textContent).not.toContain('raw.jwt.secret');
  expect(screen.queryByRole('region', { name: 'Users response' })).toBeNull();
});

it('handles status and transport errors using fixed sanitized messages', async () => {
  const { default: Panel } = await import('../PrivilegeUserApiKeysPanel');
  apiClient.get.mockRejectedValue(new Error('raw-secret'));
  render(<Panel />);
  await screen.findByText('Unable to load vault status.');
  expect(document.body.textContent).not.toContain('raw-secret');
});

it('keeps users only in current component state and removes them on new run or remount', async () => {
  const { unmount, Panel } = await panel();
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  ids();
  apiClient.post.mockResolvedValueOnce({ data: { ok: true, stages: [], httpStatus: 200, users: { name: 'Ephemeral user', token: '[REDACTED]' } } });
  run(); await screen.findByText(/Ephemeral user/);
  expect(screen.getByRole('region', { name: 'Users response' })).toHaveTextContent('[REDACTED]');
  apiClient.post.mockRejectedValueOnce(new Error('raw-secret'));
  run();
  expect(screen.queryByRole('region', { name: 'Users response' })).toBeNull();
  await screen.findByText('Privilege user API request failed.');
  unmount(); render(<Panel />); await screen.findByText(STATUS.apiKeyPreview);
  expect(screen.queryByRole('region', { name: 'Users response' })).toBeNull();
  expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
});
