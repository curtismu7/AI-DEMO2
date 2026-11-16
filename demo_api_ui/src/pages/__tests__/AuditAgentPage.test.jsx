import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditAgentPage from '../AuditAgentPage';

const apiClientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ default: apiClientMock }));

const ANSWER = { reply: 'Two applications changed.', steps: ['tools/list', 'tools/call'], applications: [{ name: 'Demo App', changes: 2 }] };

function respond({ chat }) {
  apiClientMock.get.mockImplementation(async () => ({
    data: { presets: [{ label: 'PingOne Audit', url: 'https://audit.example.test/mcp' }], config: { mcpUrl: 'https://audit.example.test/mcp' }, oauth: { authenticated: true } },
  }));
  apiClientMock.post.mockImplementation(async (url) => {
    if (url.endsWith('/tools/list')) return { data: { tools: [] } };
    if (url.endsWith('/chat')) return chat();
    throw new Error(`unexpected ${url}`);
  });
}

async function ask() {
  render(<MemoryRouter><AuditAgentPage /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Ask the audit agent'), { target: { value: 'Which apps changed?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

beforeEach(() => {
  // The pane's JSON button saves a page-wide choice; keep one test from leaking it into the next.
  localStorage.clear();
  apiClientMock.get.mockReset();
  apiClientMock.post.mockReset();
});

describe('AuditAgentPage answer pane', () => {
  it('shows no answer pane before a question is asked', async () => {
    respond({ chat: async () => ({ data: ANSWER }) });
    render(<MemoryRouter><AuditAgentPage /></MemoryRouter>);
    await screen.findByLabelText('Ask the audit agent');
    expect(screen.queryByRole('group', { name: 'Audit agent answer' })).not.toBeInTheDocument();
  });

  it('shows the answer as a named pane, Form view by default, with no hand-rolled pre', async () => {
    respond({ chat: async () => ({ data: ANSWER }) });
    await ask();
    const pane = await screen.findByRole('group', { name: 'Audit agent answer' });
    expect(pane).toHaveTextContent('Two applications changed.');
    expect(pane).toHaveTextContent('Demo App');
    expect(pane.closest('.aap-answer').querySelector('pre')).toBeNull();
  });

  it('shows the exact pretty-printed JSON after choosing JSON', async () => {
    respond({ chat: async () => ({ data: ANSWER }) });
    await ask();
    await screen.findByRole('group', { name: 'Audit agent answer' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Audit agent answer view' })).getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="Audit agent answer"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify(ANSWER, null, 2));
  });

  it('shows a failed ask as the error object in the same pane', async () => {
    respond({ chat: async () => { throw new Error('relay down'); } });
    await ask();
    const pane = await screen.findByRole('group', { name: 'Audit agent answer' });
    expect(pane).toHaveTextContent('error');
    expect(pane).toHaveTextContent('relay down');
  });
});
