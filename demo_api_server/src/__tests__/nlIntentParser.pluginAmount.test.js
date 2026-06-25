jest.mock('../../services/verticalDispatch', () => ({ hasPlugin: jest.fn(() => true), heuristicsFor: jest.fn() }));
const dispatch = require('../../services/verticalDispatch');
const { parseHeuristic } = require('../../services/nlIntentParser');

it('does NOT attach amount for a non-amount heuristic', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /records/, action: 'view_records' }]);
  const out = parseHeuristic('show my top 5 records', 'health');
  expect(out.params.amount).toBeUndefined();
});
it('attaches amount only when the heuristic opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /pay/, action: 'pay_bill', extractsAmount: true }]);
  const out = parseHeuristic('pay 50 now', 'health');
  expect(out.params.amount).toBe(50);
});
it('extracts provider + when for an appointment heuristic that opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /book|schedule/, action: 'book_appointment', extractsAppointmentParams: true }]);
  const out = parseHeuristic('book with Dr. Smith on Friday', 'health');
  expect(out.params).toEqual({ when: 'friday', provider: 'dr smith' });
});
it('extracts a department provider + relative when for an appointment heuristic', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /book|schedule/, action: 'book_appointment', extractsAppointmentParams: true }]);
  const out = parseHeuristic('schedule cardiology next week', 'health');
  expect(out.params).toEqual({ when: 'next week', provider: 'cardiology' });
});
it('extracts product + amount for a checkout heuristic that opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /checkout|buy/, action: 'checkout', extractsCheckoutParams: true }]);
  const out = parseHeuristic('checkout buy headphones $79', 'retail');
  expect(out.params).toEqual({ amount: 79, product: 'headphones' });
});
it('extracts a numeric recordId for a release heuristic that opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /release/, action: 'release_records', extractsRecordId: true }]);
  const out = parseHeuristic('release record 102', 'health');
  expect(out.params).toEqual({ recordId: '102' });
});
it('extracts days for a time-off heuristic that opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /request|take|days/, action: 'request_time_off', extractsDays: true }]);
  const out = parseHeuristic('request 3 days off', 'workforce');
  expect(out.params).toEqual({ days: 3 });
});
