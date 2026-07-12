const { buildAdminSystemPrompt } = require('../config/admin/systemPrompt');

describe('buildAdminSystemPrompt', () => {
  test('returns the base prompt with no customer selected', () => {
    const p = buildAdminSystemPrompt();
    expect(p).toMatch(/administrative assistant/i);
    expect(p).not.toMatch(/already selected/i);
  });

  test('grounds the prompt in the picker-selected customer', () => {
    const p = buildAdminSystemPrompt({ id: '1', name: 'John Doe' });
    expect(p).toMatch(/John Doe/);
    expect(p).toMatch(/id: 1/);
    expect(p).toMatch(/already selected/i);
  });

  test('ignores a customer object with no id', () => {
    const p = buildAdminSystemPrompt({ name: 'John Doe' });
    expect(p).not.toMatch(/already selected/i);
  });
});
