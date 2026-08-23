import { describe, it, expect } from 'vitest';
import { windowTranscript } from './transcriptWindow';

describe('windowTranscript', () => {
  it('slices to the most recent `cap` items when over the cap', () => {
    const msgs = Array.from({ length: 200 }, (_, i) => i);
    const { hiddenCount, visible } = windowTranscript(msgs, 150, false);
    expect(hiddenCount).toBe(50);
    expect(visible).toHaveLength(150);
    expect(visible[0]).toBe(50);
    expect(visible[visible.length - 1]).toBe(199);
  });

  it('returns everything unsliced when at or under the cap', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => i);
    const { hiddenCount, visible } = windowTranscript(msgs, 150, false);
    expect(hiddenCount).toBe(0);
    expect(visible).toEqual(msgs);
  });

  it('returns everything when showAll is true, regardless of cap', () => {
    const msgs = Array.from({ length: 200 }, (_, i) => i);
    const { hiddenCount, visible } = windowTranscript(msgs, 150, true);
    expect(hiddenCount).toBe(0);
    expect(visible).toEqual(msgs);
  });
});
