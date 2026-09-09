/**
 * AttackSimResult must survive a token-chain event whose `status` is a number.
 *
 * `/api/demo/attack-sim/run` returns numeric (HTTP-code) statuses on the
 * gateway hops of two sims — measured live on ai-demo.ping-devops.com
 * 2026-09-08:
 *
 *   cross-owner-account (UC10)  20 events, status types: string, number, undefined
 *   rogue-actor         (UC13)  21 events, status types: string, number, undefined
 *   the other eight sims        string only
 *
 * The renderer did `(ev.status || '').toLowerCase()`, so `403` threw
 * "toLowerCase is not a function" during render and the error boundary
 * replaced the whole Use Cases page — UC10 and UC13 could not be run, and
 * clicking either also took every other card down with it.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { AttackSimResult } from '../UseCaseLauncherPage';

const NUMERIC_STATUS_RESULT = {
  status: 403,
  errorCode: 'resource_owner_mismatch',
  reason: 'Account belongs to another owner.',
  tokenChainEvents: [
    { label: 'User token', status: 'active' },
    { label: 'Gateway introspection', status: 200 },
    { label: 'Gateway authorize', status: 403 },
    { label: 'Audit', status: undefined },
    { label: 'Tool call', status: 'error' },
  ],
};

describe('AttackSimResult with numeric event statuses', () => {
  it('renders every event instead of throwing on a numeric status', () => {
    expect(() => render(<AttackSimResult result={NUMERIC_STATUS_RESULT} />)).not.toThrow();
    expect(screen.getByText('Gateway authorize')).toBeInTheDocument();
    expect(screen.getByText('Tool call')).toBeInTheDocument();
    // The numeric status still shows its value to the presenter.
    expect(screen.getAllByText('403').length).toBeGreaterThan(0);
  });

  it('still flags string deny/error statuses as denied', () => {
    const { container } = render(<AttackSimResult result={NUMERIC_STATUS_RESULT} />);
    const denied = container.querySelectorAll('.uc-sim-result__event--deny');
    // Exactly the 'error' event — a numeric 403 is not in the deny vocabulary,
    // and must not silently become one.
    expect(denied).toHaveLength(1);
    expect(denied[0].textContent).toContain('Tool call');
  });

  it('an all-string result is unchanged', () => {
    const { container } = render(
      <AttackSimResult
        result={{
          status: 401,
          errorCode: 'invalid_aud',
          reason: 'Audience mismatch.',
          tokenChainEvents: [
            { label: 'User token', status: 'active' },
            { label: 'Gateway', status: 'error' },
          ],
        }}
      />,
    );
    expect(container.querySelectorAll('.uc-sim-result__event--deny')).toHaveLength(1);
  });
});
