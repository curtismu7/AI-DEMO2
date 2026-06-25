import { applyChipLabels } from '../BankingChips';

const HEURISTIC = [
  { id: 'balance', label: 'Check Balance', message: 'balance' },
  { id: 'accounts', label: 'My Accounts', message: 'accounts' },
];

test('applyChipLabels overlays manifest labels by key; message/id unchanged', () => {
  const out = applyChipLabels(HEURISTIC, [
    { key: 'balance', label: 'Rewards Points' },
    { key: 'accounts', label: 'My Orders' },
  ]);
  expect(out[0]).toEqual({ id: 'balance', label: 'Rewards Points', message: 'balance' });
  expect(out[1]).toEqual({ id: 'accounts', label: 'My Orders', message: 'accounts' });
});

test('applyChipLabels returns originals when no manifest chips', () => {
  expect(applyChipLabels(HEURISTIC, null)).toEqual(HEURISTIC);
});
