import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CimdClientIdentity from '../CimdClientIdentity';
import apiClient from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const READY = {
  ok: true,
  checks: [
    { id: 'as_supports_cimd', label: 'Gateway advertises client_id_metadata_document_supported', pass: true, detail: 'true' },
    { id: 'doc_redirect', label: "Document lists this client's callback", pass: true, detail: 'https://app.example.test/cb' },
  ],
  targets: { documentUrl: 'https://app.example.test/doc.json' },
};

const NOT_READY = {
  ok: false,
  checks: [{ id: 'doc_fetch', label: 'Client document fetches', pass: false, detail: 'HTTP 302' }],
  targets: { documentUrl: 'https://app.example.test/doc.json' },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/privilege-mcp/state') return Promise.resolve({ data: { clientIdentity: 'dcr' } });
    return Promise.resolve({ data: READY });
  });
  apiClient.post.mockImplementation((_url, body) => Promise.resolve({ data: { clientIdentity: body.mode } }));
});

describe('CimdClientIdentity', () => {
  it('starts on dynamic registration and shows the mode the server reports', async () => {
    apiClient.get.mockImplementationOnce(() => Promise.resolve({ data: { clientIdentity: 'cimd' } }));
    render(<CimdClientIdentity />);
    await waitFor(() => expect(screen.getByTestId('cimd-identity-select').value).toBe('cimd'));
  });

  it('switching to a client document posts the mode and explains what changes', async () => {
    render(<CimdClientIdentity />);
    fireEvent.change(screen.getByTestId('cimd-identity-select'), { target: { value: 'cimd' } });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp/client-identity', { mode: 'cimd' }));
    expect(await screen.findByText(/client_id will be the URL of our client document/)).toBeTruthy();
    expect(screen.getByText(/no secret/)).toBeTruthy();
  });

  it('a failed switch says so and keeps the previous mode', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('network'));
    render(<CimdClientIdentity />);
    fireEvent.change(screen.getByTestId('cimd-identity-select'), { target: { value: 'cimd' } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not change the client identity.');
    expect(screen.getByTestId('cimd-identity-select').value).toBe('dcr');
  });

  it('shows each readiness check as pass or fail, with the document URL', async () => {
    render(<CimdClientIdentity />);
    fireEvent.click(screen.getByTestId('cimd-check'));
    const verdict = await screen.findByTestId('cimd-verdict');
    expect(verdict.textContent).toMatch(/Ready/);
    const items = within(screen.getByTestId('cimd-checks')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/^✓ Gateway advertises/);
    expect(screen.getByText(/Document: https:\/\/app\.example\.test\/doc\.json/)).toBeTruthy();
  });

  it('a failing check is marked with the reason, not hidden', async () => {
    apiClient.get.mockImplementation((url) => (url === '/api/privilege-mcp/state'
      ? Promise.resolve({ data: { clientIdentity: 'dcr' } })
      : Promise.resolve({ data: NOT_READY })));
    render(<CimdClientIdentity />);
    fireEvent.click(screen.getByTestId('cimd-check'));
    expect((await screen.findByTestId('cimd-verdict')).textContent).toMatch(/Not ready/);
    expect(screen.getByTestId('cimd-checks').textContent).toMatch(/✕ Client document fetches: HTTP 302/);
  });

  it('a check that cannot run reports that instead of an empty result', async () => {
    apiClient.get.mockImplementation((url) => (url === '/api/privilege-mcp/state'
      ? Promise.resolve({ data: { clientIdentity: 'dcr' } })
      : Promise.reject(new Error('502'))));
    render(<CimdClientIdentity />);
    fireEvent.click(screen.getByTestId('cimd-check'));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not run the readiness check.');
  });
});
