'use strict';

/**
 * A catalog `match` block that can never be reached is dead code that reads as
 * live routing.
 *
 * deriveUseCaseId() reverse-maps a tool call to a useCaseId by scanning
 * USE_CASES in order and returning the FIRST entry whose match.tool agrees and
 * whose amount band contains the amount. So a later entry declaring a match
 * that an earlier entry already covers is unreachable — it looks like it routes
 * something, and it routes nothing.
 *
 * Found on brave-mcp-crypto-deny, which declared the identical
 * `{ tool: 'brave_news_search' }` as brave-mcp-search-permit sitting above it.
 * Removing that one is what this test was written for; it then turned up three
 * more, which are pinned below rather than quietly fixed — changing which use
 * case a tool call is filed under is a policy/telemetry decision, not cleanup.
 *
 * This is a ratchet, in the same spirit as themingRatchet.test.js: the list may
 * SHRINK, never grow. If you make one reachable, delete it from the list in the
 * same commit. If a new id shows up here, you have written a dead match — give
 * it a real discriminator or drop the block.
 */

const { USE_CASES, deriveUseCaseId } = require('../config/useCases');

// Pre-existing on the day this guard was added. Never add to this list.
//   entitlement-tiered-capability   — its create_transfer amount band sits
//                                     inside step-up-required's, which is above it
//   enterprise-managed-mcp-access   — both declare a bare { tool: 'get_balance' },
//   enterprise-mcp-revocation         already claimed by delegated-access-with-proof
const KNOWN_UNREACHABLE = [
  'enterprise-managed-mcp-access',
  'enterprise-mcp-revocation',
  'entitlement-tiered-capability',
];

/** An amount inside this entry's band, or undefined when it declares none. */
function probeAmount(m) {
  if (m.amountMin != null && m.amountMax != null) {
    return (Number(m.amountMin) + Number(m.amountMax)) / 2;
  }
  if (m.amountMin != null) return Number(m.amountMin);
  if (m.amountMax != null) return Number(m.amountMax);
  return undefined;
}

function unreachable() {
  return USE_CASES.filter((u) => u.match && u.match.tool)
    .filter((u) => {
      const amount = probeAmount(u.match);
      const args = amount != null ? { amount } : {};
      return deriveUseCaseId(u.match.tool, args) !== u.useCaseId;
    })
    .map((u) => u.useCaseId)
    .sort();
}

describe('catalog match blocks are reachable', () => {
  test('the probe found match blocks to check (guards a silently-empty pass)', () => {
    expect(USE_CASES.filter((u) => u.match && u.match.tool).length).toBeGreaterThan(0);
  });

  test('no use case declares a match that deriveUseCaseId can never return', () => {
    expect(unreachable()).toEqual([...KNOWN_UNREACHABLE].sort());
  });

  test('brave-mcp-crypto-deny stays free of the shadowed match it used to carry', () => {
    const deny = USE_CASES.find((u) => u.useCaseId === 'brave-mcp-crypto-deny');
    expect(deny).toBeDefined();
    expect(deny.match).toBeUndefined();
  });
});
