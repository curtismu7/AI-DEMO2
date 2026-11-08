// Ping UI Standard conversion of /agent-builder: banner first, cards/chips/kv, exactly one primary per state,
// aria-disabled (never `disabled`) on action buttons, and keyboard focus that stays put or moves to the replacement.
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('../../services/agentBuilderService', () => ({
  fetchState: vi.fn(),
  buildAgent: vi.fn(),
  deleteAgent: vi.fn(),
  upgradeAgent: vi.fn(),
  applyGrants: vi.fn(),
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  listAgents: vi.fn(),
  agentSetup: vi.fn(),
  errorMessage: (err) => err?.message || 'Request failed',
}));
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

import AgentBuilderPage from '../AgentBuilderPage';
import {
  fetchState, listAgents, buildAgent, applyGrants, createResource, deleteAgent, deleteResource,
} from '../../services/agentBuilderService';

const USER = { username: 'alex', email: 'alex@example.test', sub: 'sub-123' };
const AGENT = {
  id: 'ping-agent-123', name: 'AI Agent - alex', type: 'AI_AGENT', fallback: false,
  grantTypes: ['CLIENT_CREDENTIALS'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
  cimd: { mocked: true, status: 'registered', metadataUrl: null, steps: [] },
};
const RESOURCES = [
  { id: 'r1', name: 'Banking API', audience: 'https://b.example.test', scopes: ['read', 'write'], granted: ['read'], ownedByUser: false },
  { id: 'r2', name: 'Weather', audience: '', scopes: ['read'], granted: [], ownedByUser: true },
];

function seed({ agent = AGENT, resources = RESOURCES } = {}) {
  fetchState.mockResolvedValue({ user: USER, agent, resources: resources.map((r) => ({ ...r })) });
  listAgents.mockResolvedValue([]);
}

const primaries = (container) => [...container.querySelectorAll('button')].filter((b) => b.classList.contains('pu-btn--primary'));

beforeEach(() => {
  vi.clearAllMocks();
  buildAgent.mockResolvedValue({});
  applyGrants.mockResolvedValue({});
  createResource.mockResolvedValue({});
  deleteAgent.mockResolvedValue({});
  deleteResource.mockResolvedValue({});
});

test('the banner is the first element and says what is live and what is mocked', async () => {
  seed();
  const { container } = render(<AgentBuilderPage />);
  const banner = await screen.findByTestId('ab-banner');
  expect(banner).toHaveAttribute('role', 'note');
  expect(banner).toHaveTextContent(/change your PingOne environment for real/);
  expect(banner).toHaveTextContent(/CIMD[\s\S]*mocked facade/);
  expect(container.querySelector('.pu-page').firstElementChild).toContainElement(banner);
});

test('cards, chips with words and a kv list are present; the mocked CIMD card carries a Mocked chip', async () => {
  seed();
  const { container } = render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  expect(container.querySelectorAll('.pu-card').length).toBeGreaterThanOrEqual(5);
  expect(container.querySelector('dl.pu-kv')).toBeInTheDocument();
  const chips = [...container.querySelectorAll('.pu-chip')];
  expect(chips.length).toBeGreaterThan(0);
  chips.forEach((c) => expect(c.textContent.trim().length).toBeGreaterThan(0));
  expect(within(screen.getByTestId('ab-cimd')).getByText('Mocked')).toBeInTheDocument();
});

describe('exactly one primary button per state', () => {
  test('no agent: Build my Agent is the primary; Apply grants is not', async () => {
    seed({ agent: null });
    const { container } = render(<AgentBuilderPage />);
    await screen.findByRole('button', { name: 'Build my Agent' });
    const p = primaries(container);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveTextContent('Build my Agent');
  });

  test('agent with unsaved scope ticks: Apply grants is the primary', async () => {
    seed();
    const { container } = render(<AgentBuilderPage />);
    await screen.findByTestId('ab-agent-card');
    await userEvent.click(screen.getByText('write', { selector: 'code' }));
    const p = primaries(container);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveTextContent('Apply grants');
    expect(p[0]).not.toHaveAttribute('aria-disabled');
  });

  test('saved legacy OIDC agent: Upgrade to AI Agent is the primary', async () => {
    seed({ agent: { ...AGENT, fallback: true, type: 'WORKER' } });
    const { container } = render(<AgentBuilderPage />);
    await screen.findByRole('button', { name: 'Upgrade to AI Agent' });
    const p = primaries(container);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveTextContent('Upgrade to AI Agent');
  });

  test('legacy agent with unsaved ticks: Apply grants wins, Upgrade is a secondary', async () => {
    seed({ agent: { ...AGENT, fallback: true, type: 'WORKER' } });
    const { container } = render(<AgentBuilderPage />);
    await screen.findByTestId('ab-agent-card');
    await userEvent.click(screen.getByText('write', { selector: 'code' }));
    const p = primaries(container);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveTextContent('Apply grants');
  });

  test('saved AI_AGENT: Apply grants stays the one primary, shown unavailable', async () => {
    seed();
    const { container } = render(<AgentBuilderPage />);
    await screen.findByTestId('ab-agent-card');
    const p = primaries(container);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveTextContent('Apply grants');
    expect(p[0]).toHaveAttribute('aria-disabled', 'true');
  });
});

test('no button uses the disabled attribute (aria-disabled keeps keyboard focus)', async () => {
  seed();
  const { container } = render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
});

test('an unavailable Apply grants ignores clicks', async () => {
  seed();
  render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  await userEvent.click(screen.getByRole('button', { name: 'Apply grants' }));
  expect(applyGrants).not.toHaveBeenCalled();
});

test('Apply grants keeps keyboard focus through the submit and announces the result', async () => {
  seed();
  render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  await userEvent.click(screen.getByText('write', { selector: 'code' }));
  const btn = screen.getByRole('button', { name: 'Apply grants' });
  btn.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(applyGrants).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId('ab-status')).toHaveTextContent('Grants applied in PingOne.'));
  expect(screen.getByRole('button', { name: 'Apply grants' })).toHaveFocus();
});

test('Create resource: Enter in a field submits, and the button keeps focus when the name is empty', async () => {
  seed();
  render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  const create = screen.getByRole('button', { name: 'Create resource' });
  expect(create).toHaveAttribute('aria-disabled', 'true');
  create.focus();
  await userEvent.keyboard('{Enter}');
  expect(createResource).not.toHaveBeenCalled();
  expect(create).toHaveFocus();
  await userEvent.type(screen.getByLabelText('Resource name'), 'Maps{Enter}');
  await waitFor(() => expect(createResource).toHaveBeenCalledWith({ name: 'Maps', audience: undefined, scopes: ['read', 'write', 'admin'] }));
});

test('Build my Agent moves focus to the new agent card', async () => {
  fetchState.mockResolvedValueOnce({ user: USER, agent: null, resources: RESOURCES.map((r) => ({ ...r })) });
  listAgents.mockResolvedValue([]);
  render(<AgentBuilderPage />);
  const build = await screen.findByRole('button', { name: 'Build my Agent' });
  fetchState.mockResolvedValue({ user: USER, agent: AGENT, resources: RESOURCES.map((r) => ({ ...r })) });
  build.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(buildAgent).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('ab-agent-card')).toHaveFocus());
});

test('Delete agent: focus moves to Cancel, back to Delete on cancel, and to Build after the delete', async () => {
  seed();
  render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  await userEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete agent' })).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
  fetchState.mockResolvedValue({ user: USER, agent: null, resources: RESOURCES.map((r) => ({ ...r })) });
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
  await waitFor(() => expect(deleteAgent).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Build my Agent' })).toHaveFocus());
});

test('a load error renders the banner and an alert with a word', async () => {
  fetchState.mockRejectedValue(new Error('BFF down'));
  listAgents.mockResolvedValue([]);
  render(<AgentBuilderPage />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Error');
  expect(alert).toHaveTextContent('BFF down');
  expect(screen.getByTestId('ab-banner')).toBeInTheDocument();
});

// The focus targets that replace a clicked control must be announced by name when they take focus.
test('Build my Agent: the focused agent card is a named region', async () => {
  fetchState.mockResolvedValueOnce({ user: USER, agent: null, resources: RESOURCES.map((r) => ({ ...r })) });
  listAgents.mockResolvedValue([]);
  render(<AgentBuilderPage />);
  const build = await screen.findByRole('button', { name: 'Build my Agent' });
  fetchState.mockResolvedValue({ user: USER, agent: AGENT, resources: RESOURCES.map((r) => ({ ...r })) });
  build.focus();
  await userEvent.keyboard('{Enter}');
  const card = await screen.findByRole('region', { name: 'Your AI Agent' });
  await waitFor(() => expect(card).toHaveFocus());
  expect(card).toHaveAttribute('id', 'ab-agent-card');
});

test('Upgrade to AI Agent: focus lands on the named agent card region', async () => {
  seed({ agent: { ...AGENT, fallback: true, type: 'WORKER' } });
  render(<AgentBuilderPage />);
  const up = await screen.findByRole('button', { name: 'Upgrade to AI Agent' });
  fetchState.mockResolvedValue({ user: USER, agent: AGENT, resources: RESOURCES.map((r) => ({ ...r })) });
  up.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('region', { name: 'Your AI Agent' })).toHaveFocus());
});

test('Delete resource: focus lands on the named Your resources region', async () => {
  seed();
  render(<AgentBuilderPage />);
  const del = await screen.findByRole('button', { name: 'Delete resource Weather' });
  fetchState.mockResolvedValue({ user: USER, agent: AGENT, resources: [RESOURCES[0]].map((r) => ({ ...r })) });
  del.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(deleteResource).toHaveBeenCalledWith('r2'));
  const region = screen.getByRole('region', { name: 'Your resources' });
  await waitFor(() => expect(region).toHaveFocus());
  expect(region).toHaveAttribute('id', 'ab-mine');
});

// A 100-character unbroken audience must wrap, not clip. end-user-nano sets `word-wrap: break-word` on
// `.end-user-nano code` (0,1,1), so the page rule needs a higher specificity than one class and the value
// `anywhere` (it shrinks the flex item's min-content). jsdom has no layout, so this pins the rule and the DOM it
// applies to; the 375px geometry was measured in a browser (see the PR).
test('a 100-character audience sits in a code box the wrapping rule applies to', async () => {
  const aud = `https://${'a'.repeat(92)}`;
  expect(aud).toHaveLength(100);
  seed({ resources: [{ ...RESOURCES[0], audience: aud }, RESOURCES[1]] });
  const { container } = render(<AgentBuilderPage />);
  await screen.findByTestId('ab-agent-card');
  const box = container.querySelector('.ab-aud');
  expect(box).toHaveTextContent(aud);
  expect(box.tagName).toBe('CODE');
  expect(box.closest('.pu-page.ab-page')).not.toBeNull();
  const css = readFileSync(join(__dirname, '..', 'AgentBuilderPage.css'), 'utf8');
  const rule = css.match(/\.pu-page\.ab-page code[^{]*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule[1]).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/\.ab-aud\s*\{[^}]*min-width:\s*0/);
});
