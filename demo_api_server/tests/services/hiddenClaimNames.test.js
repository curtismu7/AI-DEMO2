'use strict';
/**
 * sanitizeClaims drops any claim not on its allowlist, deliberately: an
 * unexpected claim could be PII or a credential. The defect was that it did so
 * SILENTLY — the Token Chain panel rendered the surviving claims and gave no
 * sign the token had more, so a viewer built to teach what is inside a token
 * quietly showed a curated subset.
 *
 * hiddenClaimNames reports what was removed BY NAME ONLY. These tests pin both
 * halves: that hidden claims are reported, and that their values never are.
 */
const { sanitizeClaims, hiddenClaimNames } = require('../../services/agentMcpTokenService');

const CLAIMS = {
    // allowlisted
    sub: 'user-1',
    aud: 'mcpgateway.ping.demo',
    scope: 'read write',
    iss: 'https://auth.pingone.com/abc',
    // NOT allowlisted
    at_hash: 'SECRET-AT-HASH-VALUE',
    'p1:custom': 'SECRET-CUSTOM-VALUE',
    nonce: 'SECRET-NONCE-VALUE',
};

describe('hiddenClaimNames', () => {
    test('names every claim the allowlist dropped', () => {
        expect(hiddenClaimNames(CLAIMS)).toEqual(['at_hash', 'nonce', 'p1:custom']);
    });

    test('never reveals a hidden claim VALUE', () => {
        // The whole point: a name is not the secret. If this ever serialises
        // values, the sanitiser has been defeated by the thing meant to explain it.
        const serialised = JSON.stringify(hiddenClaimNames(CLAIMS));
        for (const secret of ['SECRET-AT-HASH-VALUE', 'SECRET-CUSTOM-VALUE', 'SECRET-NONCE-VALUE']) {
            expect(serialised).not.toContain(secret);
        }
    });

    test('reports nothing when every claim survived', () => {
        const allAllowed = { sub: 'u', aud: 'a', scope: 's', iss: 'i' };
        expect(hiddenClaimNames(allAllowed)).toEqual([]);
    });

    test('stays consistent with sanitizeClaims — kept and hidden partition the input', () => {
        // Guards the real drift risk: someone widens the allowlist and this
        // reporter keeps claiming a now-visible claim is hidden.
        const kept = Object.keys(sanitizeClaims(CLAIMS));
        const hidden = hiddenClaimNames(CLAIMS);
        expect([...kept, ...hidden].sort()).toEqual(Object.keys(CLAIMS).sort());
        expect(kept.filter((k) => hidden.includes(k))).toEqual([]);
    });

    test('handles absent or non-object input', () => {
        expect(hiddenClaimNames(null)).toEqual([]);
        expect(hiddenClaimNames(undefined)).toEqual([]);
        expect(hiddenClaimNames('nope')).toEqual([]);
    });
});
