const { createWorkforceStore } = require('../../config/verticals/workforce/data');

describe('workforce data store', () => {
  let store;
  beforeEach(() => { store = createWorkforceStore(); });

  it('clones seed per user (independent copies)', () => {
    const a = store.get('user-a');
    store.get('user-b');
    a.expenses.push({ id: 'x' });
    expect(store.get('user-b').expenses.find((e) => e.id === 'x')).toBeUndefined();
  });

  it('submitExpense appends an expense (status Submitted) and returns it', () => {
    const exp = store.submitExpense('user-a', { category: 'Meals', amount: 42 });
    expect(exp.id).toBeDefined();
    expect(exp.status).toBe('Submitted');
    expect(exp.amount).toBe(42);
    expect(store.get('user-a').expenses.some((e) => e.id === exp.id)).toBe(true);
  });

  it('requestTimeOff decrements pto balance and returns remaining', () => {
    const before = store.get('user-a').pto.balance;
    const out = store.requestTimeOff('user-a', { days: 3 });
    expect(out.days).toBe(3);
    expect(out.remaining).toBe(before - 3);
    expect(store.get('user-a').pto.balance).toBe(before - 3);
  });

  it('requestTimeOff returns an error when insufficient balance', () => {
    const out = store.requestTimeOff('user-a', { days: 999 });
    expect(out.error).toBeDefined();
  });
});
