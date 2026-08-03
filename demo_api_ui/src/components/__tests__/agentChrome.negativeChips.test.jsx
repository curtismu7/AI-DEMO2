import { describe, it, expect } from 'vitest';
import { verticalSuggestionChips } from '../agentChrome';

const MANIFEST = {
  dashboard: {
    chips10: [
      { id: 'gv-direct', label: 'Permits', message: 'view my permits' },
      { id: 'gv-dpop', label: 'DPoP / replay defense', message: 'fire a token with the wrong audience at the gateway', mode: 'direct', tool: 'test_wrong_audience' },
      { id: 'gv-deny', label: 'Authz DENY', message: "show a patient's health record", mode: 'direct', denyTool: 'show_health_record' },
    ],
  },
};

describe('verticalSuggestionChips negative-chip fields', () => {
  it('carries mode, tool and denyTool through; nulls when absent', () => {
    const chips = verticalSuggestionChips(MANIFEST);
    expect(chips[0]).toMatchObject({ id: 'gv-direct', mode: null, tool: null, denyTool: null });
    expect(chips[1]).toMatchObject({ mode: 'direct', tool: 'test_wrong_audience', denyTool: null });
    expect(chips[2]).toMatchObject({ mode: 'direct', tool: null, denyTool: 'show_health_record' });
  });

  it('does not disturb existing fields', () => {
    const chips = verticalSuggestionChips(MANIFEST);
    expect(chips[0]).toMatchObject({ label: 'Permits', message: 'view my permits', desc: 'view my permits', hitlTrigger: false, challenge: null });
  });
});
