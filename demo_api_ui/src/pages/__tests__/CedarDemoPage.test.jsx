// Drives the page against the REAL Cedar engine (node build injected in place of the browser loader).
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../cedar/loadCedar', async () => {
  const cedar = (await import('@cedar-policy/cedar-wasm/nodejs')).default;
  return { loadCedar: () => Promise.resolve(cedar) };
});

import CedarDemoPage from '../CedarDemoPage';

// @xyflow/react observes its container's size; jsdom has no ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const outcome = () => screen.getByTestId('cedar-decision').getAttribute('data-outcome');
const ready = async () => { render(<CedarDemoPage />); await waitFor(() => expect(screen.getByTestId('cedar-decision')).toHaveAttribute('data-outcome')); };

describe('CedarDemoPage', () => {
  it('says plainly that it is the open-source engine and not the gateway, and loads the first scenario as ALLOW', async () => {
    await ready();
    expect(screen.getByTestId('cedar-honesty')).toHaveTextContent(/open-source Cedar engine \(v[\d.]+\)/);
    expect(screen.getByTestId('cedar-honesty')).toHaveTextContent(/not Ping's gateway/);
    expect(outcome()).toBe('allow');
    expect(screen.getByTestId('cedar-notice')).toHaveTextContent(/Matches the expected result \(ALLOW\)/);
  });

  it('hold then approve: a large unattended fare is held with its approver, and approving lifts it', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('scn-hold-large'));
    await waitFor(() => expect(outcome()).toBe('hold'));
    expect(screen.getByTestId('cedar-decision')).toHaveTextContent('s01-hold-large-fare');
    expect(screen.getByTestId('cedar-decision')).toHaveTextContent('approver: priya');
    fireEvent.click(screen.getByRole('button', { name: /Approve as priya/ }));
    await waitFor(() => expect(outcome()).toBe('allow'));
  });

  it.each([
    ['default-deny', 'default-deny'],
    ['cap', 'deny'],
    ['schema-drift', 'deny'],
    ['finance-pay', 'allow'],
  ])('scenario %s decides %s', async (id, expected) => {
    await ready();
    fireEvent.click(screen.getByTestId(`scn-${id}`));
    await waitFor(() => expect(outcome()).toBe(expected));
  });

  it('rejects a policy on raw claims at validation and evaluates nothing', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('try-raw-claims'));
    await waitFor(() => expect(outcome()).toBe('error'));
    expect(screen.getByTestId('cedar-decision')).toHaveTextContent(/Rejected by strict validation/);
    expect(screen.getByTestId('cedar-decision')).toHaveTextContent(/claims/);
  });

  it('editing the caller changes the decision and drops the scenario match note', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText(/groups \(comma separated\)/), { target: { value: '' } });
    await waitFor(() => expect(outcome()).toBe('default-deny'));
    expect(screen.queryByTestId('cedar-notice')).toBeNull();
  });

  it('shows the request as Cedar sees it, with groups as principal parents', async () => {
    await ready();
    const req = JSON.parse(screen.getByTestId('cedar-request').textContent);
    expect(req).toMatchObject({ principal: 'User::"mary"', parents: ['Group::"analysts"'], action: 'Action::"mcp:Invoke"', resource: 'Tool::"search_docs"' });
    expect(req.context).toMatchObject({ app: 'search', token: { scopes: ['tools:invoke'] } });
  });

  it('marks demo-only attributes in the vocabulary table, and embeds the diagram', async () => {
    await ready();
    const vocab = screen.getByTestId('cedar-vocab');
    expect(within(vocab).getAllByText('demo only').length).toBeGreaterThanOrEqual(3);
    expect(within(vocab).getByText('context.token.scopes')).toBeInTheDocument();
    expect(screen.getByTestId('cedar-diagram')).toBeInTheDocument();
  });
});
