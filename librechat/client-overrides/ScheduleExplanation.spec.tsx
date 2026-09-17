import { getScheduleExplanation } from '../ScheduleExplanation';

describe('scheduled chat explanations', () => {
  test('explains the read-only morning report', () => {
    expect(getScheduleExplanation('Morning balance report')).toMatchObject({
      summary: expect.stringContaining('balances'),
      successMeaning: expect.stringContaining('chat'),
    });
  });

  test('explains the gateway connection prerequisite', () => {
    expect(getScheduleExplanation('Daily rentals check')).toMatchObject({
      summary: expect.stringContaining('rentals'),
      recovery: expect.stringContaining('gateway'),
    });
  });

  test('distinguishes a successful sweep run from a completed transfer', () => {
    expect(getScheduleExplanation('Weekly savings sweep')).toMatchObject({
      summary: expect.stringContaining('$750'),
      successMeaning: expect.stringContaining('does not mean money moved'),
    });
  });
});
