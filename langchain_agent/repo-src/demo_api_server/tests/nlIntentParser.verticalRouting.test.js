'use strict';

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: {
      activeId: jest.fn(() => 'banking'),
      resolve: jest.fn((id) => {
        if (id === 'workforce') {
          return {
            terminology: { account: 'benefits' },
            dashboard: { chips: [{ label: 'My benefits', message: 'my benefits' }] },
          };
        }
        return null;
      }),
    },
  },
}));

const {
  resolveVerticalCtx,
  resolveVerticalRouting,
  parseVerticalParam,
} = require('../services/nlIntentParser');

describe('parseVerticalParam', () => {
  it('accepts valid ids and rejects invalid', () => {
    expect(parseVerticalParam('workforce')).toBe('workforce');
    expect(parseVerticalParam(null)).toBeNull();
    expect(parseVerticalParam('Bad_ID')).toBeNull();
  });
});

describe('resolveVerticalCtx', () => {
  it('returns null for banking', () => {
    expect(resolveVerticalCtx('banking')).toBeNull();
  });

  it('returns terminology + chips for non-banking verticals', () => {
    const ctx = resolveVerticalCtx('workforce');
    expect(ctx.terminology.account).toBe('benefits');
    expect(ctx.chips).toHaveLength(1);
  });
});

describe('resolveVerticalRouting', () => {
  it('uses request vertical over global active', () => {
    const { verticalManifest } = require('../services/verticalManifest');
    verticalManifest.resolver.activeId.mockReturnValue('banking');

    const { verticalId, verticalCtx } = resolveVerticalRouting('workforce');
    expect(verticalId).toBe('workforce');
    expect(verticalCtx.terminology.account).toBe('benefits');
  });

  it('falls back to active vertical when request vertical is absent', () => {
    const { verticalManifest } = require('../services/verticalManifest');
    verticalManifest.resolver.activeId.mockReturnValue('workforce');

    const { verticalId, verticalCtx } = resolveVerticalRouting(null);
    expect(verticalId).toBe('workforce');
    expect(verticalCtx.terminology.account).toBe('benefits');
  });
});
