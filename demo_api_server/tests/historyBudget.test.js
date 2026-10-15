'use strict';

const { trimHistoryToBudget, budgetFromEnv, DEFAULT_BUDGET_TOKENS } = require('../services/historyBudget');

const msg = (role, chars, tag = role[0]) => ({ role, content: tag.repeat(chars) });
const total = (messages) => messages.reduce((n, m) => n + Math.ceil(String(m.content).length / 4), 0);

describe('trimHistoryToBudget', () => {
  test('a long thread is cut to the budget, dropping the oldest first', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}`.padStart(2, '0') + 'x'.repeat(2000) }));
    const out = trimHistoryToBudget(history, 2500);
    expect(total(out)).toBeLessThanOrEqual(2500);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(30);
    // what is kept is the NEWEST run, in order
    expect(out[out.length - 1].content.startsWith('29')).toBe(true);
    expect(out[0].content.slice(0, 2)).toBe(String(30 - out.length).padStart(2, '0'));
  });

  test('a short thread is left alone', () => {
    const history = [msg('user', 40), msg('assistant', 80)];
    expect(trimHistoryToBudget(history, 2500)).toEqual(history);
  });

  test('one huge saved tool result is shortened instead of evicting everything else', () => {
    const history = [msg('user', 40), msg('assistant', 60000, 'T'), msg('user', 40)];
    const out = trimHistoryToBudget(history, 2500);
    expect(total(out)).toBeLessThanOrEqual(2500);
    const big = out.find((m) => m.content.startsWith('TTT'));
    expect(big.content.endsWith('[earlier output shortened]')).toBe(true);
    expect(big.content.length).toBeLessThan(2500 * 4 * 0.4 + 60);
  });

  test('does not modify the saved history, and handles empty or non-string content', () => {
    const history = [msg('assistant', 20000)];
    const copy = JSON.parse(JSON.stringify(history));
    trimHistoryToBudget(history, 1000);
    expect(history).toEqual(copy);
    expect(trimHistoryToBudget([], 1000)).toEqual([]);
    expect(trimHistoryToBudget(undefined, 1000)).toEqual([]);
    expect(trimHistoryToBudget([{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }], 1000)).toHaveLength(1);
  });

  test('a budget of 0 drops the history entirely; the env var sets the budget', () => {
    expect(trimHistoryToBudget([msg('user', 40)], 0)).toEqual([]);
    expect(budgetFromEnv({})).toBe(DEFAULT_BUDGET_TOKENS);
    expect(budgetFromEnv({ LLM_HISTORY_TOKEN_BUDGET: '4000' })).toBe(4000);
    expect(budgetFromEnv({ LLM_HISTORY_TOKEN_BUDGET: 'nonsense' })).toBe(DEFAULT_BUDGET_TOKENS);
  });
});
