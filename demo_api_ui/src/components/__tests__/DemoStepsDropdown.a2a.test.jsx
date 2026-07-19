// demo_api_ui/src/components/__tests__/DemoStepsDropdown.a2a.test.jsx
import { describe, it, expect } from 'vitest';
import { a2aEventsForExplain } from '../demoStepsA2a';

describe('a2aEventsForExplain', () => {
  it('returns the last run a2a-* events for an A2A use case', () => {
    const store = { getState: () => ({ tokenEvents: [
      { id: 'user-token' },
      { id: 'a2a-exchange2', specialist: 'Investment Advisor' },
    ] }) };
    const out = a2aEventsForExplain({ id: 'UC2' }, store);
    expect(out.some((e) => e.id === 'a2a-exchange2')).toBe(true);
    expect(out.some((e) => e.id === 'user-token')).toBe(false);
  });
  it('returns [] for a non-A2A use case', () => {
    const store = { getState: () => ({ tokenEvents: [{ id: 'a2a-exchange2' }] }) };
    expect(a2aEventsForExplain({ id: 'UC7' }, store)).toEqual([]);
  });
  it('returns [] when the store has no trace', () => {
    const store = { getState: () => ({}) };
    expect(a2aEventsForExplain({ id: 'UC2' }, store)).toEqual([]);
  });
  it('returns a2a-* events from the real store shape ({ trace: { tokenEvents } })', () => {
    const store = { getState: () => ({ trace: { tokenEvents: [
      { id: 'user-token' },
      { id: 'a2a-exchange2', specialist: 'Investment Advisor' },
    ] } }) };
    const out = a2aEventsForExplain({ id: 'UC2' }, store);
    expect(out.some((e) => e.id === 'a2a-exchange2')).toBe(true);
    expect(out.some((e) => e.id === 'user-token')).toBe(false);
  });
});
