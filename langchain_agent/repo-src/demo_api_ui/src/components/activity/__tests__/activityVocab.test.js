import { describe, it, expect } from 'vitest';
import { renderTemplate, toolPhrase } from '../activityVocab';

describe('renderTemplate', () => {
  it('substitutes the institution token', () => {
    expect(renderTemplate('deny', { institution: 'Clinic' }))
      .toBe("The Clinic said no — that action isn't allowed.");
  });

  it('falls back to "service" when institution is missing', () => {
    expect(renderTemplate('permit')).toBe('The service approved the request.');
  });

  it('returns empty string for an unknown key', () => {
    expect(renderTemplate('nope', { institution: 'Bank' })).toBe('');
  });

  it('substitutes the phrase token for tool steps', () => {
    expect(renderTemplate('toolRunning', { phrase: 'Reading your balance' }))
      .toBe('Reading your balance…');
  });
});

describe('toolPhrase', () => {
  it('maps a known tool to a verb pair', () => {
    expect(toolPhrase('get_balance')).toEqual({ running: 'Reading your balance', done: 'Read your balance' });
  });

  it('humanizes an unknown tool name', () => {
    expect(toolPhrase('list_recent_orders'))
      .toEqual({ running: 'Working on list recent orders', done: 'Finished list recent orders' });
  });
});
