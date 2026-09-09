'use strict';

/**
 * A RAR grant may only claim consent when a HUMAN approved it.
 *
 * The Agent Intent Governance policy denies a mutating action whose grant
 * cannot prove consent (`intent-not-consented`). That deny is only honest if
 * `consented` is stamped from a real approval — stamping it on every grant would
 * turn the strongest rule in the policy into a rubber stamp, and stamping it on
 * a grant built from the request's own params would be worse: that grant is
 * circular by construction (see _resolveRarGrantSource's own note), so it proves
 * the call was not mutated in transit and nothing about intent.
 *
 * So: `consented` + `expires_at` come from the HITL challenge the human
 * approved, and from nowhere else.
 */

const hitlServiceClient = require('../services/hitlServiceClient');
const configStore = require('../services/configStore');
const {
  buildRarAuthorizationDetails,
  _buildAgenticExtras,
} = require('../services/agentMcpTokenService');

describe('buildRarAuthorizationDetails — consent provenance', () => {
  const params = { amount: 80, to_account_id: 'acme-utilities' };

  it('omits consent when no approval is supplied', () => {
    const [detail] = buildRarAuthorizationDetails('create_transfer', params, 'user-1');
    expect(detail.amount).toBe(80);
    expect(detail.payee).toBe('acme-utilities');
    // Absent, not false — the policy attribute's own default (false) applies,
    // and an absent field can never be mistaken for a positive assertion.
    expect(detail).not.toHaveProperty('consented');
    expect(detail).not.toHaveProperty('expires_at');
  });

  it('stamps consent and expiry from a human approval', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const [detail] = buildRarAuthorizationDetails('create_transfer', params, 'user-1', {
      consented: true,
      expiresAt,
    });
    expect(detail.consented).toBe(true);
    expect(detail.expires_at).toBe(expiresAt);
  });

  it('stamps consent but omits expiry when the approval has no usable expiry', () => {
    // The policy defaults IntentGrantExpired to TRUE, so an unknown lifetime
    // denies rather than granting consent that never lapses.
    for (const expiresAt of [null, undefined, NaN, 0, 'not-a-date']) {
      const [detail] = buildRarAuthorizationDetails('create_transfer', params, 'user-1', {
        consented: true,
        expiresAt,
      });
      expect(detail.consented).toBe(true);
      expect(detail).not.toHaveProperty('expires_at');
    }
  });

  it('never stamps consent from a falsy consent object', () => {
    for (const consent of [undefined, null, {}, { consented: false }]) {
      const [detail] = buildRarAuthorizationDetails('create_transfer', params, 'user-1', consent);
      expect(detail).not.toHaveProperty('consented');
    }
  });
});

describe('_resolveRarGrantSource — only an approved challenge yields consent', () => {
  const ARG = hitlServiceClient.HITL_CHALLENGE_ARG || '_hitl_challenge_id';
  let getChallengeStatus;

  beforeEach(() => {
    getChallengeStatus = jest.spyOn(hitlServiceClient, 'getChallengeStatus');
    // RAR is default-OFF; arm only it, leaving every other flag to its real value.
    const real = configStore.getEffective.bind(configStore);
    jest.spyOn(configStore, 'getEffective').mockImplementation(
      (key) => (key === 'ff_rar' ? 'true' : real(key)),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  // _resolveRarGrantSource is module-private; reach it through _buildAgenticExtras,
  // which is the real caller and is already exported.
  const reqWith = (extra) => ({
    body: { params: { amount: 80, to_account_id: 'acme-utilities', ...extra } },
  });

  it('an approved challenge produces a consented grant bounded by its expiry', async () => {
    const expiresAtIso = new Date(Date.now() + 300_000).toISOString();
    getChallengeStatus.mockResolvedValue({
      status: 'approved',
      tool: 'create_transfer',
      userId: 'user-1',
      expiresAt: expiresAtIso,
      context: { amount: 80, to_account_id: 'acme-utilities' },
    });

    const { extras } = await _buildAgenticExtras(
      reqWith({ [ARG]: 'chal-1' }), 'create_transfer', 'user-1', [],
    );

    expect(extras.rarProvenance).toBe('human_approval');
    const [detail] = extras.rarDetails;
    expect(detail.consented).toBe(true);
    expect(detail.expires_at).toBe(Math.floor(Date.parse(expiresAtIso) / 1000));
  });

  it('an UNapproved challenge falls back to request params and claims no consent', async () => {
    getChallengeStatus.mockResolvedValue({
      status: 'pending',
      tool: 'create_transfer',
      userId: 'user-1',
      context: { amount: 80 },
    });

    const { extras } = await _buildAgenticExtras(
      reqWith({ [ARG]: 'chal-1' }), 'create_transfer', 'user-1', [],
    );

    expect(extras.rarProvenance).toBe('request_params');
    expect(extras.rarDetails[0]).not.toHaveProperty('consented');
  });

  it('an approval for a DIFFERENT tool claims no consent', async () => {
    getChallengeStatus.mockResolvedValue({
      status: 'approved',
      tool: 'delete_account',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      context: { amount: 80 },
    });

    const { extras } = await _buildAgenticExtras(
      reqWith({ [ARG]: 'chal-1' }), 'create_transfer', 'user-1', [],
    );

    expect(extras.rarProvenance).toBe('request_params');
    expect(extras.rarDetails[0]).not.toHaveProperty('consented');
  });

  it('a HITL lookup failure claims no consent rather than failing open', async () => {
    getChallengeStatus.mockRejectedValue(new Error('hitl unreachable'));

    const { extras } = await _buildAgenticExtras(
      reqWith({ [ARG]: 'chal-1' }), 'create_transfer', 'user-1', [],
    );

    expect(extras.rarProvenance).toBe('request_params');
    expect(extras.rarDetails[0]).not.toHaveProperty('consented');
  });
});
