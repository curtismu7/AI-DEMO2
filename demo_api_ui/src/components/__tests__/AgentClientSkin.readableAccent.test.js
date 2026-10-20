import { describe, it, expect } from 'vitest';
import { readableAccent } from '../AgentClientSkin';

describe('readableAccent', () => {
  it('keeps the accent when it is readable on the background', () => {
    expect(readableAccent('#d20e0f', '#ffffff', '#051727')).toBe('#d20e0f');
  });

  it('falls back when the accent is too close to the background (Ping blue on a dark skin)', () => {
    expect(readableAccent('#12538d', '#0b1929', '#d8e8ff')).toBe('#d8e8ff');
  });

  it('returns the accent unchanged for values it cannot parse', () => {
    expect(readableAccent('rebeccapurple', '#ffffff', '#051727')).toBe('rebeccapurple');
  });
});
