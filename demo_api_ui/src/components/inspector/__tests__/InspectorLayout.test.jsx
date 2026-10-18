import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InspectorLayout from '../InspectorLayout.jsx';

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const base = { src: 'you', ms: 12, chips: [], corr: 'corr-1', request: { label: 'Request', body: { a: 1 } }, response: { label: 'Response', body: { b: 2 } }, banner: null };
const c1 = {
  ...base, id: 'c1', at: 1700000000, kind: 'tools/call', title: 'get_my_accounts', status: { tone: 'ok', label: '200 OK' },
  tokens: [{ label: 'MCP token', role: 'r', alg: 'RS256', rfc: 'RFC 8693', status: { tone: 'ok', label: 'Valid' }, claims: { sub: 'u1', scope: 'a', iat: 1700000000 }, hidden: [], header: null, diff: { scope: 'narrowed' } }],
  hops: [
    { dir: 'Browser → BFF', call: 'POST /api/x', what: 'w1', status: { tone: 'ok', label: '200' }, ms: 5, request: {}, response: {} },
    { dir: 'BFF → PingOne', call: 'POST /token', what: 'w2', status: { tone: 'ok', label: '200' }, ms: 7, request: {}, response: {} },
  ],
  steps: [
    { status: { tone: 'ok', label: 'ok' }, title: 'Step one', text: 't1' },
    { status: { tone: 'ok', label: 'ok' }, title: 'Step two', text: 't2', kv: [['aud', 'x']] },
  ],
  audit: { Who: [['userSub', 'u1']] }, logs: ['line one'],
};
const c2 = {
  ...base, id: 'c2', at: 1700000100, kind: 'tools/call', title: 'get_sensitive_account_details', status: { tone: 'err', label: '403' },
  response: { label: 'Response', body: { b: 3 } },
  banner: { tone: 'err', title: 'Refused', text: 't', testId: 'elicitation-card', actions: [{ label: 'Confirm', onClick: vi.fn() }] },
  tokens: [], hops: [{ dir: 'Browser → BFF', call: 'POST /api/y', what: 'w', status: { tone: 'err', label: '403' }, ms: 3, request: {}, response: {} }],
  steps: [{ status: { tone: 'err', label: 'denied' }, title: 'Only step', text: 't' }],
};

function setup(over = {}) {
  const props = {
    eyebrow: 'PingOne MCP', title: 'MCP Inspector', lede: 'Lede text.',
    related: [{ label: 'Bulk', to: '/pingone-authorize?tab=bulk' }, { label: 'Other', to: '/other' }],
    mode: { tone: 'ok', label: 'Live' },
    source: { label: 'Server', value: 'a', options: [{ value: 'a', label: 'AI Demo MCP' }], onChange: vi.fn() },
    send: <div>send card</div>, calls: [c2, c1], callsNote: 'Newest first.',
    selectedId: 'c1', onSelect: vi.fn(), onResend: vi.fn(), onEdit: vi.fn(), ...over,
  };
  const utils = render(<MemoryRouter><InspectorLayout {...props} /></MemoryRouter>);
  return { props, ...utils };
}
const tab = (re) => screen.getByRole('tab', { name: re });

describe('InspectorLayout', () => {
  it('renders header, mode chip and call count', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'MCP Inspector' })).toBeTruthy();
    expect(screen.getByText('PingOne MCP')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('send card')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Calls\s*2/ })).toBeTruthy();
  });

  it('selecting a row calls onSelect', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /get_\s*sensitive/ }));
    expect(props.onSelect).toHaveBeenCalledWith('c2');
  });

  it('Problems filter hides ok calls', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    expect(screen.queryByRole('button', { name: /get_\s*my_\s*accounts/ })).toBeNull();
    expect(screen.getByRole('button', { name: /get_\s*sensitive/ })).toBeTruthy();
  });

  it('What happened is the default tab and lists steps', () => {
    setup();
    expect(screen.getByText('Step one')).toBeTruthy();
    expect(screen.getByText('Step two')).toBeTruthy();
    expect(screen.getByText('MCP audit record (5W1H)')).toBeTruthy();
    expect(screen.getByText('Gateway log lines for this call')).toBeTruthy();
  });

  it('Tokens tab shows the server-decoded note and diff chip', () => {
    setup();
    fireEvent.click(tab(/Tokens/));
    expect(screen.getByText(/Decoded on the server/)).toBeTruthy();
    expect(screen.getByText('narrowed')).toBeTruthy();
    expect(screen.getByText('All claims (JSON)')).toBeTruthy();
  });

  it('Tokens tab on a tokenless call', () => {
    setup({ selectedId: 'c2' });
    fireEvent.click(tab(/Tokens/));
    expect(screen.getByText('This call carried no tokens.')).toBeTruthy();
  });

  it('API calls tab lists hops with a count', () => {
    setup();
    expect(tab(/API calls\s*2/)).toBeTruthy();
    fireEvent.click(tab(/API calls/));
    expect(screen.getByText('Browser → BFF')).toBeTruthy();
    expect(screen.getByText('BFF → PingOne')).toBeTruthy();
  });

  it('Diagram tab follows the diagram rule', () => {
    const { container } = setup();
    fireEvent.click(tab(/Diagram/));
    const nodes = container.querySelectorAll('.react-flow__node-sfd');
    expect(nodes.length).toBe(3);
    nodes.forEach((n) => expect(n.classList.contains('draggable')).toBe(true));
    expect(screen.getByRole('button', { name: /Simulate/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy();
    expect(container.querySelector('.dc-steptime-select')).toBeTruthy();
  });

  it('single-hop diagram renders', () => {
    const { container } = setup({ selectedId: 'c2' });
    fireEvent.click(tab(/Diagram/));
    expect(container.querySelectorAll('.react-flow__node-sfd').length).toBe(2);
  });

  it('Compare shows differences', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/Compare with/), { target: { value: 'c2' } });
    expect(screen.getByText(/fields? differ/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop comparing' })).toBeTruthy();
    expect(tab(/Request & response/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Call 2 response' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Call 1 response' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop comparing' }));
    expect(screen.queryByRole('button', { name: 'Stop comparing' })).toBeNull();
  });

  it('Resend and Edit call the page callbacks', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(props.onResend).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('banner keeps its test id and runs actions', () => {
    setup({ selectedId: 'c2' });
    const b = screen.getByTestId('elicitation-card');
    expect(within(b).getByText('Refused')).toBeTruthy();
    fireEvent.click(within(b).getByRole('button', { name: 'Confirm' }));
    expect(c2.banner.actions[0].onClick).toHaveBeenCalled();
  });

  it('empty calls', () => {
    setup({ calls: [], selectedId: null });
    expect(screen.getByText('No calls yet. Send one above, or use the AI agent.')).toBeTruthy();
  });

  it('long title wraps', () => {
    const { container } = setup();
    expect(container.querySelector('.insp-call-title').innerHTML).toContain('<wbr>');
  });

  it('related links route', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Bulk' }).getAttribute('href')).toBe('/pingone-authorize?tab=bulk');
  });
});
