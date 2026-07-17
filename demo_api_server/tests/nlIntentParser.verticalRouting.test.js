'use strict';

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    plugins: { get: jest.fn(() => null) },
    resolver: {
      // Process-global still flipped by other demos — must not steer heuristics.
      activeId: jest.fn(() => 'manufacturing'),
      activeIdFor: jest.fn((req) =>
        (req && req.session && req.session.active_vertical) || 'manufacturing'),
      resolve: jest.fn((id) => {
        if (id === 'workforce') {
          return {
            terminology: { account: 'benefits' },
            dashboard: { chips: [{ label: 'My benefits', message: 'my benefits' }] },
          };
        }
        if (id === 'manufacturing') {
          return {
            terminology: { account: 'work order' },
            dashboard: {
              chips10: [{ label: 'My work orders', message: 'show my work orders', mode: 'both' }],
            },
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
  parseHeuristic,
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
  it('uses request vertical over session and process-global', () => {
    const req = { session: { active_vertical: 'banking' } };
    const { verticalId, verticalCtx } = resolveVerticalRouting('workforce', req);
    expect(verticalId).toBe('workforce');
    expect(verticalCtx.terminology.account).toBe('benefits');
  });

  it('uses session pin when request vertical is absent', () => {
    const req = { session: { active_vertical: 'workforce' } };
    const { verticalId, verticalCtx } = resolveVerticalRouting(null, req);
    expect(verticalId).toBe('workforce');
    expect(verticalCtx.terminology.account).toBe('benefits');
  });

  it('defaults to banking — never process-global manufacturing — when body and session omit vertical', () => {
    const { verticalManifest } = require('../services/verticalManifest');
    expect(verticalManifest.resolver.activeId()).toBe('manufacturing');

    const { verticalId, verticalCtx } = resolveVerticalRouting(null, { session: {} });
    expect(verticalId).toBe('banking');
    expect(verticalCtx).toBeNull();
  });

  it('keeps banking heuristics when session is banking even if global is manufacturing', () => {
    const req = { session: { active_vertical: 'banking' } };
    const { verticalId, verticalCtx } = resolveVerticalRouting(null, req);
    expect(verticalId).toBe('banking');
    expect(verticalCtx).toBeNull();

    const h = parseHeuristic('show my accounts', verticalId, verticalCtx);
    expect(h.kind).toBe('banking');
    expect(h.banking.action).toBe('accounts');
  });
});
