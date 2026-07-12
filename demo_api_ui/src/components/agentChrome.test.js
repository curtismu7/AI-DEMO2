import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HitlChipMark, verticalSuggestionChips } from './agentChrome';

describe('HitlChipMark challenge markers', () => {
  test('consent → 👤 only', () => {
    const { container } = render(<HitlChipMark challenge="consent" />);
    expect(container.textContent).toContain('👤');
    expect(container.textContent).not.toContain('🔑');
  });
  test('both → 👤🔑', () => {
    const { container } = render(<HitlChipMark challenge="both" />);
    expect(container.textContent).toContain('👤');
    expect(container.textContent).toContain('🔑');
  });
  test('step_up → 🔑 only', () => {
    const { container } = render(<HitlChipMark challenge="step_up" />);
    expect(container.textContent).toContain('🔑');
    expect(container.textContent).not.toContain('👤');
  });
  test('verticalSuggestionChips carries challenge', () => {
    const chips = verticalSuggestionChips({ dashboard: { chips10: [{ id: 'a', label: 'A', message: 'a', challenge: 'both' }] } });
    expect(chips[0].challenge).toBe('both');
  });
});
