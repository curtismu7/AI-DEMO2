// demo_api_ui/src/components/__tests__/PolicyDecisionTree.test.jsx
// The real tree (the page test mocks it): path overlay, inactive-branch collapse, legend, embedded mode, hook order.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PolicyDecisionTree from '../PolicyDecisionTree';

const POLICIES = [
  {
    id: 'ps', kind: 'POLICY_SET', name: 'Payments set', algorithm: 'First applicable',
    children: [
      {
        id: 'pol', kind: 'POLICY', name: 'Transfer policy',
        children: [
          { id: 'r-permit', kind: 'RULE', name: 'Standard approval', effect: 'PERMIT', children: [] },
          { id: 'r-deny', kind: 'RULE', name: 'Block high amount', effect: 'DENY', children: [] },
        ],
      },
    ],
  },
];
const RESULT = {
  decision: 'PERMIT',
  raw: { statements: [{ name: 'Approved', code: 'PERMIT', fulfilled: true }], elapsedMicroseconds: 1500 },
};

const card = (name) => screen.queryByText(name)?.closest('.p1dt-card') ?? null;

test('marks the rule that matched a returned statement, with its path, bubble and the verdict banner', () => {
  const { container } = render(<PolicyDecisionTree policies={POLICIES} result={RESULT} />);
  const banner = container.querySelector('.p1dt-decision-banner');
  expect(banner).toHaveTextContent('Decision:');
  expect(banner).toHaveTextContent('APPROVED');
  expect(banner).toHaveTextContent('1.500 ms');

  expect(card('Standard approval')).toHaveClass('is-path');
  expect(card('Standard approval')).not.toHaveClass('is-na');
  expect(card('Standard approval').querySelector('.p1dt-bubble')).toHaveTextContent('1');
  expect(card('Transfer policy')).toHaveClass('is-path');
  expect(card('Payments set')).toHaveClass('is-path');
});

test('inactive branches start collapsed behind a toggle that expands and collapses them', () => {
  render(<PolicyDecisionTree policies={POLICIES} result={RESULT} />);
  expect(card('Block high amount')).toBeNull();
  const toggle = screen.getByRole('button', { name: '+ 1 inactive branch hidden' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(toggle);
  expect(card('Block high amount')).toHaveClass('is-na');
  const open = screen.getByRole('button', { name: '- Collapse 1 inactive' });
  expect(open).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(open);
  expect(card('Block high amount')).toBeNull();
});

test('Expand all and Collapse all inactive drive every branch, with the inactive count in the summary', () => {
  render(<PolicyDecisionTree policies={POLICIES} result={RESULT} />);
  expect(screen.getByText('1 inactive node (not on execution path)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
  expect(card('Block high amount')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all inactive' }));
  expect(card('Block high amount')).toBeNull();
});

test('lists the returned statements and the legend; a statement with no rule is reported as unmapped', () => {
  const result = { ...RESULT, raw: { statements: [...RESULT.raw.statements, { name: 'Odd thing', code: 'zzz' }] } };
  const { container } = render(<PolicyDecisionTree policies={POLICIES} result={result} />);
  expect(screen.getByText('Statements returned by PingOne (2)')).toBeInTheDocument();
  expect(screen.getByText(/1 statement could not be mapped to a rule node/)).toBeInTheDocument();
  const legend = container.querySelector('.p1dt-legend');
  expect(within(legend).getByText(/Execution path/)).toBeInTheDocument();
  expect(within(legend).getByText(/N\/A/)).toBeInTheDocument();
});

test('embedded mode drops the banner and the title (the host page owns them) but keeps the tree', () => {
  const { container } = render(<PolicyDecisionTree policies={POLICIES} result={RESULT} embedded />);
  expect(container.querySelector('.p1dt')).toHaveClass('p1dt--embedded');
  expect(container.querySelector('.p1dt-decision-banner')).toBeNull();
  expect(screen.queryByText('Policy decision trace')).toBeNull();
  expect(card('Standard approval')).toBeInTheDocument();
});

test('renders nothing without a result or policies, and survives the props flipping (hook order)', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { container, rerender } = render(<PolicyDecisionTree policies={[]} result={RESULT} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<PolicyDecisionTree policies={POLICIES} result={RESULT} />);
  expect(card('Standard approval')).toHaveClass('is-path');
  expect(card('Block high amount')).toBeNull(); // auto-collapse still computed from the populated props
  rerender(<PolicyDecisionTree policies={POLICIES} result={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<PolicyDecisionTree policies={POLICIES} result={RESULT} />);
  expect(card('Standard approval')).toBeInTheDocument();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
