import { describe, it, expect } from 'vitest';
import { DEFAULT_STEP_UP_ACR_VALUE } from '../setupDefaults';

describe('setupDefaults', () => {
  it('exports the default step-up ACR value used across the setup wizard', () => {
    expect(DEFAULT_STEP_UP_ACR_VALUE).toBe('Multi_Factor');
  });
});
