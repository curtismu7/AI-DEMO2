import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { ProofOfEnforcementProvider, useProofOfEnforcement } from '../ProofOfEnforcementContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

// UC8 "hitl-consent" dispatches a different primaryTool per vertical. Mirrors
// demo_api_server/config/useCases.js AMOUNT_PRIMARY_TOOL_BY_VERTICAL — update
// this list if that map changes.
const HITL_TOOL_BY_VERTICAL = {
  banking: 'create_transfer',
  healthcare: 'pay_bill',
  retail: 'checkout',
  'abercrombie-fitch': 'checkout',
  government: 'pay_fee',
  university: 'pay_tuition_balance',
  workforce: 'submit_expense',
  'sporting-goods': 'extend_rental',
  manufacturing: 'approve_purchase_order',
  investment: 'large_trade',
  airlines: 'pay_airline_fee',
};

function Probe() {
  const { verdict } = useProofOfEnforcement();
  return <div data-testid="verdict">{verdict ? `${verdict.useCaseId}:${verdict.state}` : 'none'}</div>;
}

beforeEach(() => {
  tokenChainTraceStore.reset();
});

// Regression for REGRESSION_PLAN.md 2026-08-19 ("UC8 'HITL consent' flipped
// from green to 'Mismatch' the moment the human approved") — found live on
// sporting-goods, fixed generically in ingestAuthorize, then reported again
// live on airlines. The store-level fix is vertical-agnostic (it never reads
// tool/vertical), but nothing previously proved that end-to-end against every
// vertical's real primaryTool — this closes that gap.
describe.each(Object.entries(HITL_TOOL_BY_VERTICAL))(
  'UC8 hitl-consent approve→retry — %s (%s)',
  (vertical, tool) => {
    test('renders "denied-as-expected", never "mismatch", after the gateway-authoritative approval retry', async () => {
      const catalog = [{
        useCaseId: 'hitl-consent',
        title: 'HITL consent',
        expectedOutcome: 'HITL_REQUIRED',
        evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp', 'hitl'] },
        primaryTool: tool,
      }];
      global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ useCases: catalog }) }));

      const { getByTestId } = render(
        <ProofOfEnforcementProvider vertical={vertical}>
          <Probe />
        </ProofOfEnforcementProvider>,
      );
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      act(() => {
        // PingOne Authorize returns the HITL obligation for this tool/amount.
        tokenChainTraceStore.ingestAuthorize({
          decision: 'INDETERMINATE', outcome: 'HITL_REQUIRED', useCaseId: 'hitl-consent', vertical,
        });
      });
      await waitFor(() => expect(getByTestId('verdict').textContent).toBe('hitl-consent:denied-as-expected'));

      act(() => {
        // Human approves. On the gateway-authoritative path (measured live
        // 2026-08-18/19) the retry answers with a SKIP shape carrying no
        // `decision` at all; the real PERMIT lands separately as gw-authorize.
        tokenChainTraceStore.ingestAuthorize({
          ran: false, skipped: true, skipReason: 'gateway_authoritative',
          decisionContext: 'McpFirstTool', useCaseId: 'hitl-consent', vertical,
        });
        tokenChainTraceStore.ingestTokenEvent({ id: 'gw-authorize', decision: 'PERMIT', backend: 'real', tool });
      });

      await waitFor(() => {
        const text = getByTestId('verdict').textContent;
        expect(text).not.toBe('hitl-consent:mismatch');
        expect(text).toBe('hitl-consent:denied-as-expected');
      });
    });
  },
);
