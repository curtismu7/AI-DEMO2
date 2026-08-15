// demo_api_ui/src/components/__tests__/AgentGatewayConfigEditor.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayConfigEditor from '../AgentGatewayConfigEditor';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Stub Monaco — we only test the Editor/Form toggle wiring, not Monaco internals.
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

const FILE_LIST = {
  files: [{ id: 'ig-config', label: 'IG Config', group: 'Gateway', reloadMode: 'auto' }],
  restart: { enabled: true, socket: true },
};

const FILE_DETAIL = {
  type: 'ig-config',
  reloadMode: 'auto',
  label: 'IG Config',
  raw: JSON.stringify({ description: 'Gateway route file', streamingEnabled: true }, null, 2),
};

function mockEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/agent-gateway/files') return Promise.resolve({ data: FILE_LIST });
    if (url === '/api/admin/agent-gateway/files/ig-config') return Promise.resolve({ data: FILE_DETAIL });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEndpoints();
});

test('defaults to Editor view showing the raw JSON in Monaco', async () => {
  render(<AgentGatewayConfigEditor />);
  await waitFor(() => {
    expect(screen.getByText('IG Config')).toBeInTheDocument();
  });
  // findByTestId waits for the element, not its value — the mock editor mounts
  // before the fetched config populates it, so asserting the value straight
  // after wins only when the fetch happens to resolve first. Under parallel
  // load it does not.
  await waitFor(() => expect(screen.getByTestId('monaco')).toHaveValue(FILE_DETAIL.raw));
  expect(screen.queryByText('Description')).toBeNull();
});

test('switching to Form view renders the parsed JSON as labeled fields', async () => {
  render(<AgentGatewayConfigEditor />);
  await waitFor(() => {
    expect(screen.getByText('IG Config')).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.queryByTestId('monaco')).toBeNull();
  expect(screen.getByText('Description')).toBeInTheDocument();
  expect(screen.getByText('Gateway route file')).toBeInTheDocument();
  expect(screen.getByText('Streaming Enabled')).toBeInTheDocument();
});

test('switching back to Editor view restores Monaco with the current value', async () => {
  render(<AgentGatewayConfigEditor />);
  await screen.findByTestId('monaco');
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
  await waitFor(() => expect(screen.getByTestId('monaco')).toHaveValue(FILE_DETAIL.raw));
});

test('shows a parse-error notice in Form view instead of crashing when JSON is invalid', async () => {
  render(<AgentGatewayConfigEditor />);
  const monaco = await screen.findByTestId('monaco');
  fireEvent.change(monaco, { target: { value: '{ invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText(/Fix JSON in Editor view first/)).toBeInTheDocument();
});
