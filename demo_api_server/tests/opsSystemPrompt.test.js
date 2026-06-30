const { buildOpsSystemPrompt } = require('../config/ops/systemPrompt');

describe('buildOpsSystemPrompt', () => {
  test('grounds in the customer + records and forbids actions', () => {
    const p = buildOpsSystemPrompt({ vertical: 'healthcare', customer: { name: 'Maya Chen' }, records: { appointments: [{ id: 'a1', status: 'Scheduled' }] } });
    expect(p).toMatch(/Healthcare/i);
    expect(p).toMatch(/Maya Chen/);
    expect(p).toMatch(/a1/);                 // record data embedded
    expect(p).toMatch(/read-only|do not|cannot (take|perform)/i);
  });
});
