import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PingOneApiPanel from '../PingOneApiPanel';

const REQUEST = { method: 'POST', url: '/v1/environments/e/users', contentType: 'application/json', body: { username: 'curt', password: { value: 'x' } } };
const RESPONSE = { id: 'u-1', enabled: true, _embedded: { population: { id: 'p-1' } } };

beforeEach(() => {
  // The pane's JSON button saves a page-wide choice; keep one test from leaking it into the next.
  localStorage.clear();
});

describe('PingOneApiPanel', () => {
  it('renders nothing for the request or response until its toggle is opened', () => {
    render(<PingOneApiPanel request={REQUEST} response={RESPONSE} />);
    expect(screen.queryByRole('group', { name: 'PingOne request body' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'PingOne response' })).not.toBeInTheDocument();
  });

  it('shows the request body and the response as named panes, Form view by default', () => {
    render(<PingOneApiPanel request={REQUEST} response={RESPONSE} />);
    fireEvent.click(screen.getByRole('button', { name: /Show PingOne Request/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show PingOne Response/ }));

    const body = screen.getByRole('group', { name: 'PingOne request body' });
    expect(body).toHaveTextContent('curt');
    expect(body).toHaveTextContent('password');
    const response = screen.getByRole('group', { name: 'PingOne response' });
    expect(response).toHaveTextContent('u-1');
    expect(response).toHaveTextContent('p-1');
  });

  it('shows the exact pretty-printed JSON after choosing JSON', async () => {
    render(<PingOneApiPanel request={REQUEST} response={RESPONSE} />);
    fireEvent.click(screen.getByRole('button', { name: /Show PingOne Response/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'PingOne response view' })).getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="PingOne response"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify(RESPONSE, null, 2));
  });

  it('hides the panes again when the toggles are closed', () => {
    render(<PingOneApiPanel request={REQUEST} response={RESPONSE} />);
    fireEvent.click(screen.getByRole('button', { name: /Show PingOne Response/ }));
    expect(screen.getByRole('group', { name: 'PingOne response' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide PingOne Response/ }));
    expect(screen.queryByRole('group', { name: 'PingOne response' })).not.toBeInTheDocument();
  });
});
