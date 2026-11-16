// TokenExchangeSection: the decoded final token, the exchange request and the live response are the shared JSON pane.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TokenExchangeSection from '../agenticAccessConsole/TokenExchangeSection';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { post: vi.fn() } }));

// header.payload.signature with payload {"sub":"demo-user","aud":"demo-resource-server"}
const payload = btoa(JSON.stringify({ sub: 'demo-user', aud: 'demo-resource-server' })).replace(/=+$/, '');
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`;

describe('TokenExchangeSection JSON panes', () => {
  beforeEach(() => {
    // One Form | JSON choice per page, kept in localStorage: a test that picks JSON must not leak it.
    localStorage.clear();
    apiClient.post.mockReset();
  });

  it('shows the illustrative final token as a Form pane and swaps it with the tab', () => {
    render(<TokenExchangeSection />);
    const token = screen.getByRole('group', { name: 'Decoded final token' });
    expect(token.textContent).toContain('oauth-mcp');
    expect(token.textContent).toContain('langchain-agent-svc');
    fireEvent.click(screen.getByRole('button', { name: 'A2A delegation (UC2)' }));
    expect(screen.getByRole('group', { name: 'Decoded final token' }).textContent).toContain('investment-gateway');
    expect(document.querySelector('pre')).toBeNull();
  });

  it('shows the request exactly as given in the JSON view', async () => {
    render(<TokenExchangeSection />);
    const box = screen.getByRole('group', { name: 'Token exchange request' }).closest('.jp-box');
    fireEvent.click(within(box).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(box.querySelector('.jp-raw')).not.toBeNull());
    expect(box.querySelector('.jp-raw').textContent).toContain('"grant_type": "urn:ietf:params:oauth:grant-type:token-exchange"');
  });

  it('shows the live response and its decoded claims as panes', async () => {
    apiClient.post.mockResolvedValue({ data: { access_token: TOKEN, token_type: 'Bearer' } });
    render(<TokenExchangeSection />);
    fireEvent.click(screen.getByRole('button', { name: /Send it/ }));
    const response = await screen.findByRole('group', { name: 'Token exchange response' });
    expect(response.textContent).toContain('Bearer');
    const claims = screen.getByRole('group', { name: 'Decoded claims of the real token' });
    expect(claims.textContent).toContain('demo-user');
    expect(within(claims).getAllByRole('button', { name: /^Copy / }).length).toBeGreaterThan(0);
  });
});
