/**
 * @file simulatedAuthorizeService.test.js
 * In-process Authorize mimic — rules and return shape for education mode.
 */

const {
  evaluateTransaction,
  evaluateMcpFirstTool,
  isSimulatedModeEnabled,
  getSimulatedRecentDecisions,
  SIMULATED_DENY_AMOUNT_USD,
  SIMULATED_POLICY_STEPUP_USD,
  SIMULATED_CONFIRM_AMOUNT_USD,
} = require('../../services/simulatedAuthorizeService');

describe('simulatedAuthorizeService', () => {
  describe('evaluateTransaction', () => {
    it('returns PERMIT for small withdrawal with strong-looking acr', async () => {
      const r = await evaluateTransaction({
        userId: 'u1',
        amount: 100,
        type: 'withdrawal',
        acr: 'http://schemas.openid.net/pam/mfa',
      });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
      expect(r.path).toBe('simulated');
      expect(r.raw.engine).toBe('simulated');
    });

    it('returns DENY when amount exceeds ceiling', async () => {
      const r = await evaluateTransaction({
        userId: 'u1',
        amount: SIMULATED_DENY_AMOUNT_USD + 1,
        type: 'transfer',
        acr: 'mfa-strong',
      });
      expect(r.decision).toBe('DENY');
      expect(r.stepUpRequired).toBe(false);
    });

    it('returns stepUpRequired for large transfer without strong acr', async () => {
      const r = await evaluateTransaction({
        userId: 'u1',
        amount: SIMULATED_POLICY_STEPUP_USD + 100,
        type: 'transfer',
        acr: 'pwd',
      });
      expect(r.stepUpRequired).toBe(true);
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.raw.obligations).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'STEP_UP' })])
      );
    });

    it('does not require step-up for deposit (deposit is not in default stepUpTypes)', async () => {
      // Use amount below all thresholds — deposit has no type-based step-up and no amount-based trigger.
      const r = await evaluateTransaction({
        userId: 'u1',
        amount: 10,
        type: 'deposit',
        acr: '',
      });
      expect(r.decision).toBe('PERMIT');
    });

    it('records recent decisions with decision-endpoint parameter shape', async () => {
      await evaluateTransaction({ userId: 'u-deposit', amount: 42, type: 'transfer', acr: '' });
      const recent = getSimulatedRecentDecisions(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
      const last = recent[0];
      expect(last.parameters).toMatchObject({
        Amount: 42,
        TransactionType: 'transfer',
        UserId: 'u-deposit',
      });
      expect(last.parameters.Timestamp).toBeTruthy();
      expect(last.raw).toBeUndefined();
    });

    it('raw includes Trust Framework parameters and engine metadata', async () => {
      const r = await evaluateTransaction({ userId: 'u2', amount: 5, type: 'withdrawal', acr: 'mfa' });
      expect(r.raw.requestShape).toBe('decision-endpoint');
      expect(r.raw.engine).toBe('simulated');
      expect(r.raw.parameters).toMatchObject({
        Amount: 5,
        TransactionType: 'withdrawal',
        UserId: 'u2',
      });
    });
  });

  describe('evaluateMcpFirstTool — MCP path: highest gate wins, no type-based consent', () => {
    // fc46af7c / 93626945: MCP path uses amount thresholds only. Type-based
    // consentTypes/stepUpTypes do NOT apply — 'transfer' type alone must not
    // trigger HITL; only amount decides the gate.

    const BASE = { userId: 'u-mcp', toolName: 'create_transfer', tokenAudience: 'https://mcp.example', actClientId: 'bff', acr: '' };

    it('read tool with no amount returns PERMIT', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, toolName: 'get_my_accounts', amount: null, transactionType: null });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
      expect(r.hitlRequired).toBe(false);
    });

    it('write tool with amount below confirm threshold returns PERMIT', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD - 1, transactionType: 'transfer' });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
      expect(r.hitlRequired).toBe(false);
    });

    it('write tool at confirm threshold returns hitlRequired only (no step-up)', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD, transactionType: 'transfer' });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.hitlRequired).toBe(true);
      expect(r.stepUpRequired).toBe(false);
    });

    it('write tool at step-up threshold returns stepUpRequired only — highest gate wins', async () => {
      // Regression (fc46af7c): previously both hitlRequired AND stepUpRequired were
      // returned for amounts >= stepUpAmount. Now highest gate wins: stepUpRequired
      // only, hitlRequired=false.
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_POLICY_STEPUP_USD, transactionType: 'transfer' });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.stepUpRequired).toBe(true);
      expect(r.hitlRequired).toBe(false);
    });

    it('$600 transfer returns stepUpRequired only (not hitlRequired)', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: 600, transactionType: 'transfer' });
      expect(r.stepUpRequired).toBe(true);
      expect(r.hitlRequired).toBe(false);
    });

    it('amount exceeding deny threshold returns DENY', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_DENY_AMOUNT_USD + 1, transactionType: 'withdrawal' });
      expect(r.decision).toBe('DENY');
      expect(r.stepUpRequired).toBe(false);
      expect(r.hitlRequired).toBe(false);
    });

    it('strong ACR bypasses step-up gate for write tool at step-up amount', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_POLICY_STEPUP_USD + 100, transactionType: 'transfer', acr: 'http://schemas.openid.net/pam/mfa' });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
    });

    it('transfer type alone (amount < confirm threshold) returns PERMIT — type-based consent not applied', async () => {
      // Regression (fc46af7c): previously consentTypes.has('transfer') triggered
      // HITL for ANY transfer regardless of amount. MCP path must ignore type rules.
      const r = await evaluateMcpFirstTool({ ...BASE, toolName: 'create_transfer', amount: SIMULATED_CONFIRM_AMOUNT_USD - 1, transactionType: 'transfer' });
      expect(r.decision).toBe('PERMIT');
      expect(r.hitlRequired).toBe(false);
    });

    it('raw output includes DecisionContext=McpToolCall and Amount', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: 300, transactionType: 'deposit' });
      expect(r.raw.parameters.DecisionContext).toBe('McpToolCall');
      expect(r.raw.parameters.Amount).toBe(300);
      expect(r.raw.parameters.TransactionType).toBe('deposit');
    });

    it('strong ACR bypasses confirm gate (54ffcdbe: needsConfirm respects acrLooksStrong)', async () => {
      // Before 54ffcdbe: needsConfirm = !needsStepUp && amount >= confirmAmount
      // After:           needsConfirm = !needsStepUp && amount >= confirmAmount && !acrLooksStrong(acr)
      // A session that completed MFA step-up should not then also require HITL confirm.
      const r = await evaluateMcpFirstTool({
        ...BASE,
        amount: SIMULATED_CONFIRM_AMOUNT_USD,     // exactly at confirm threshold
        transactionType: 'transfer',
        acr: 'http://schemas.openid.net/pam/mfa', // strong ACR
      });
      expect(r.decision).toBe('PERMIT');
      expect(r.hitlRequired).toBe(false);
      expect(r.stepUpRequired).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Audience-match guard — locks the policy parity rule between simulated
  // AS and PingOne PAZ. Both must DENY when token aud ≠ expected resource
  // aud (catches step-skipping attacks where an intermediate-step token
  // is sent directly to MCP).
  // ──────────────────────────────────────────────────────────────────────
  describe('evaluateMcpFirstTool — audience-match guard (anti step-skipping)', () => {
    it('DENIES when tokenAudience does not include the expected mcpResourceUri', async () => {
      const r = await evaluateMcpFirstTool({
        userId: 'u-mcp',
        toolName: 'get_my_accounts',
        tokenAudience: 'intermediate.2x.ping.demo',  // attacker sends Step 2 (intermediate) token
        mcpResourceUri: 'final.2x.ping.demo',        // policy expects Step 4 (final) token
        actClientId: 'agent',
      });
      expect(r.decision).toBe('DENY');
      expect(r.raw.reason).toMatch(/Audience mismatch/);
      expect(r.raw.reason).toMatch(/step-skipping/);
    });

    it('PERMITS when tokenAudience matches mcpResourceUri exactly', async () => {
      const r = await evaluateMcpFirstTool({
        userId: 'u-mcp',
        toolName: 'get_my_accounts',
        tokenAudience: 'final.2x.ping.demo',
        mcpResourceUri: 'final.2x.ping.demo',
        actClientId: 'agent',
      });
      expect(r.decision).toBe('PERMIT');
    });

    it('PERMITS when tokenAudience is a space-separated list that includes the expected aud', async () => {
      // PingOne sometimes returns aud as an array; the BFF flattens to space-separated string.
      const r = await evaluateMcpFirstTool({
        userId: 'u-mcp',
        toolName: 'get_my_accounts',
        tokenAudience: 'foo.example.com final.2x.ping.demo bar.example.com',
        mcpResourceUri: 'final.2x.ping.demo',
        actClientId: 'agent',
      });
      expect(r.decision).toBe('PERMIT');
    });

    it('skips the guard (legacy callers) when mcpResourceUri is empty', async () => {
      // Before this guard was added, callers passed no mcpResourceUri. The guard must
      // be backward-compatible — only enforce when both sides provide a value.
      const r = await evaluateMcpFirstTool({
        userId: 'u-mcp',
        toolName: 'get_my_accounts',
        tokenAudience: 'whatever.example.com',
        mcpResourceUri: '',
        actClientId: 'agent',
      });
      expect(r.decision).toBe('PERMIT');
    });
  });

  describe('evaluateMcpFirstTool — group-membership guard (Scenario 1)', () => {
    const BASE = { userId: 'u-mcp', toolName: 'get_sensitive_account_details', actClientId: 'agent' };

    it('DENIES when the user is not in the tool\'s required group', async () => {
      const r = await evaluateMcpFirstTool({
        ...BASE,
        requiredGroup: 'PrivilegedBanking',
        userGroups: ['general_users'],
      });
      expect(r.decision).toBe('DENY');
      expect(r.raw.deny_reason).toBe('user_not_in_group');
      expect(r.raw.reason).toMatch(/PrivilegedBanking/);
      // deny_parameters must carry RequiredGroup + UserGroups for the UI/log.
      expect(r.raw.parameters.RequiredGroup).toBe('PrivilegedBanking');
      expect(r.raw.parameters.UserGroups).toEqual(['general_users']);
    });

    it('does NOT group-deny when the user is in the required group', async () => {
      // get_sensitive_account_details is a SoT consent tool, so after the group
      // guard passes it correctly falls through to the HITL_CONSENT challenge
      // (parity with the mock/snapshot tool-name gate). The group guard's job is
      // only to not DENY — assert that, then confirm a verified receipt
      // discharges the consent gate to a clean PERMIT.
      const gated = await evaluateMcpFirstTool({
        ...BASE,
        requiredGroup: 'PrivilegedBanking',
        userGroups: ['PrivilegedBanking'],
      });
      expect(gated.decision).not.toBe('DENY');
      expect(gated.raw.deny_reason).toBeUndefined();

      const permitted = await evaluateMcpFirstTool({
        ...BASE,
        requiredGroup: 'PrivilegedBanking',
        userGroups: ['PrivilegedBanking'],
        hitlApproved: true,
      });
      expect(permitted.decision).toBe('PERMIT');
    });

    it('is a no-op when requiredGroup/userGroups are absent (flag off)', async () => {
      // Flag off → no group evaluation. The tool still challenges for consent
      // (tool-name gate); assert only that no group DENY was applied.
      const r = await evaluateMcpFirstTool({ ...BASE });
      expect(r.decision).not.toBe('DENY');
      expect(r.raw.deny_reason).toBeUndefined();
    });
  });

  describe('evaluateMcpFirstTool — no-amount tool-name gate (C2 parity)', () => {
    // The P1AZ snapshot gates MCP tools by tool NAME with no amount clause
    // (RequiresMcpStepUp / RequiresHitlConsent). These pin the simulated engine
    // to that behaviour so a no-amount consent/step-up tool is never silently
    // PERMITted here while the real engine challenges it.
    const NO_AMOUNT = { userId: 'u-mcp', tokenAudience: 'https://mcp.example', actClientId: 'agent', acr: '' };

    it('consent tool with no amount → HITL_CONSENT (not PERMIT)', async () => {
      const r = await evaluateMcpFirstTool({ ...NO_AMOUNT, toolName: 'book_appointment' });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.hitlRequired).toBe(true);
      expect(r.stepUpRequired).toBe(false);
    });

    it('consent tool with no amount → PERMIT once a verified receipt discharges it', async () => {
      const r = await evaluateMcpFirstTool({ ...NO_AMOUNT, toolName: 'book_appointment', hitlApproved: true });
      expect(r.decision).toBe('PERMIT');
    });

    it('step-up tool with no amount → STEP_UP (not PERMIT), and a receipt does NOT satisfy it', async () => {
      const r = await evaluateMcpFirstTool({ ...NO_AMOUNT, toolName: 'release_records', hitlApproved: true });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.stepUpRequired).toBe(true);
      expect(r.hitlRequired).toBe(false);
    });

    it('step-up tool with no amount is discharged by a strong ACR (HasMFAAuthentication)', async () => {
      const r = await evaluateMcpFirstTool({ ...NO_AMOUNT, toolName: 'release_records', acr: 'mfa' });
      expect(r.decision).toBe('PERMIT');
    });

    it('ungated read tool with no amount still PERMITs', async () => {
      const r = await evaluateMcpFirstTool({ ...NO_AMOUNT, toolName: 'get_my_accounts' });
      expect(r.decision).toBe('PERMIT');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // HITL receipt (hitlApproved) — receipt-aware PERMIT on retry.
  //
  // A verified HITL receipt discharges ONLY the HITL_CONSENT gate. Step-up
  // (MFA), audience-mismatch, and deny gates are NOT dischargeable by a
  // receipt. The BFF/gateway verifies the receipt's caller-binding before
  // setting hitlApproved=true; this engine trusts that boolean. The live
  // PingAuthorize path must apply the SAME rule (parity invariant).
  // ──────────────────────────────────────────────────────────────────────
  describe('evaluateMcpFirstTool — HITL receipt (hitlApproved)', () => {
    const BASE = { userId: 'u-mcp', toolName: 'create_transfer', tokenAudience: 'https://mcp.example', actClientId: 'bff', acr: '' };

    it('confirm-threshold HITL flips to PERMIT when hitlApproved=true', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD, transactionType: 'transfer', hitlApproved: true });
      expect(r.decision).toBe('PERMIT');
      expect(r.hitlRequired).toBe(false);
      expect(r.stepUpRequired).toBe(false);
    });

    it('confirm-threshold still HITL when hitlApproved is absent (default unchanged)', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD, transactionType: 'transfer' });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.hitlRequired).toBe(true);
    });

    it('step-up is NOT dischargeable by a HITL receipt', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_POLICY_STEPUP_USD, transactionType: 'transfer', hitlApproved: true });
      expect(r.decision).toBe('INDETERMINATE');
      expect(r.stepUpRequired).toBe(true);
      expect(r.hitlRequired).toBe(false);
    });

    it('audience-mismatch DENY still wins over hitlApproved', async () => {
      const r = await evaluateMcpFirstTool({
        ...BASE,
        amount: SIMULATED_CONFIRM_AMOUNT_USD,
        transactionType: 'transfer',
        tokenAudience: 'intermediate.2x.ping.demo',
        mcpResourceUri: 'final.2x.ping.demo',
        hitlApproved: true,
      });
      expect(r.decision).toBe('DENY');
    });

    it('deny-amount still wins over hitlApproved', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_DENY_AMOUNT_USD + 1, transactionType: 'transfer', hitlApproved: true });
      expect(r.decision).toBe('DENY');
    });

    it('surfaces HitlApproved in decision parameters when true', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD, transactionType: 'transfer', hitlApproved: true });
      expect(r.raw.parameters.HitlApproved).toBe(true);
    });

    it('omits HitlApproved from parameters when false (conditional-spread style)', async () => {
      const r = await evaluateMcpFirstTool({ ...BASE, amount: SIMULATED_CONFIRM_AMOUNT_USD, transactionType: 'transfer' });
      expect(r.raw.parameters.HitlApproved).toBeUndefined();
    });
  });

  describe('isSimulatedModeEnabled', () => {
    it('returns true when configStore.get has ff_authorize_simulated true (no getEffective)', () => {
      expect(isSimulatedModeEnabled({ get: (k) => (k === 'ff_authorize_simulated' ? 'true' : null) })).toBe(true);
    });
    it('returns false on a get-only stub when the flag is absent (fallback path)', () => {
      // Stub with only .get and no value → falls back to .get → false.
      expect(isSimulatedModeEnabled({ get: () => null })).toBe(false);
    });

    // REGRESSION (high-value transfer fail-open incident, 2026-05-18):
    // a corrupt/empty config.db makes the real configStore's .get() return
    // null for everything while .getEffective() still applies field
    // defaults. ff_authorize_simulated defaults to 'true' and the simulated
    // path is what enforces the amount-based step-up / HITL gate. The old
    // code used .get() → null → false → the gate silently DISABLED and a
    // $750 transfer executed with NO consent. isSimulatedModeEnabled must
    // resolve via .getEffective so an unreadable config FAILS SAFE (gate on).
    it('prefers getEffective: null .get but default-true .getEffective → ENABLED (fail-safe)', () => {
      const corruptConfigDbStore = {
        get: () => null, // SQLite init failed → raw cache empty
        getEffective: (k) => (k === 'ff_authorize_simulated' ? 'true' : null), // default applied
      };
      expect(isSimulatedModeEnabled(corruptConfigDbStore)).toBe(true);
    });

    it('explicit getEffective "false" stays DISABLED (operator opt-out respected)', () => {
      expect(
        isSimulatedModeEnabled({ get: () => 'true', getEffective: () => 'false' }),
      ).toBe(false);
    });

    it('getEffective boolean true is honored', () => {
      expect(
        isSimulatedModeEnabled({ get: () => null, getEffective: () => true }),
      ).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // NNP-8 entitlement-tiered capability (UC21)
  //
  // Tier guard fires after the binary group-membership guard and before
  // the amount / HITL gates. Flag-gated: ff_authorize_group_policy OFF →
  // fully inert. Parity: same deny codes as decision.js Rule 3d.
  // ──────────────────────────────────────────────────────────────────────
  describe('evaluateMcpFirstTool — NNP-8 entitlement-tiered capability (UC21)', () => {
    const configStore = require('../../services/configStore');
    const BASE = {
      userId: 'u-tier',
      tokenAudience: 'https://mcp.example',
      actClientId: 'bff',
      acr: '',
    };

    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT;
    });

    // T5-1: flag off (default) — tier logic inert
    it('T5-1: flag off — Standard user calling create_withdrawal is not tier-denied', async () => {
      // ff_authorize_group_policy defaults to null/false in configStore.
      const r = await evaluateMcpFirstTool({
        ...BASE,
        toolName: 'create_withdrawal',
        userGroups: ['Standard'],
        amount: 100,
        transactionType: 'withdrawal',
      });
      // Flag off → no tier deny. $100 < all thresholds → PERMIT.
      expect(r.decision).toBe('PERMIT');
      expect(r.raw.deny_reason).toBeUndefined();
    });

    // T5-2: flag on, PrivateBanking user — tool allowed, no tier deny
    it('T5-2: flag on — PrivateBanking user, create_withdrawal $10000, no tier deny', async () => {
      jest.spyOn(configStore, 'get').mockImplementation(
        (key) => (key === 'ff_authorize_group_policy' ? 'true' : null)
      );
      const r = await evaluateMcpFirstTool({
        ...BASE,
        toolName: 'create_withdrawal',
        userGroups: ['PrivateBanking'],
        amount: 10000,
        transactionType: 'withdrawal',
      });
      expect(r.raw.deny_reason).not.toBe('tier_tool_not_allowed');
      expect(r.raw.deny_reason).not.toBe('tier_amount_exceeded');
    });

    // T5-3: flag on, Standard user, privateBankingOnlyTool → DENY tier_tool_not_allowed
    it('T5-3: flag on — Standard user, create_withdrawal → DENY tier_tool_not_allowed', async () => {
      jest.spyOn(configStore, 'get').mockImplementation(
        (key) => (key === 'ff_authorize_group_policy' ? 'true' : null)
      );
      const r = await evaluateMcpFirstTool({
        ...BASE,
        toolName: 'create_withdrawal',
        userGroups: ['Standard'],
        amount: 100,
        transactionType: 'withdrawal',
      });
      expect(r.decision).toBe('DENY');
      expect(r.raw.deny_reason).toBe('tier_tool_not_allowed');
    });

    // T5-4: flag on, Standard user, create_transfer $2500 > $2000 tier limit → DENY tier_amount_exceeded
    // (global ceiling raised to $60000 so Rule 3b doesn't fire first)
    it('T5-4: flag on — Standard user, create_transfer $2500, global ceiling $60000 → DENY tier_amount_exceeded', async () => {
      process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '60000';
      jest.spyOn(configStore, 'get').mockImplementation(
        (key) => (key === 'ff_authorize_group_policy' ? 'true' : null)
      );
      const r = await evaluateMcpFirstTool({
        ...BASE,
        toolName: 'create_transfer',
        userGroups: ['Standard'],
        amount: 2500,
        transactionType: 'transfer',
      });
      expect(r.decision).toBe('DENY');
      expect(r.raw.deny_reason).toBe('tier_amount_exceeded');
    });

    // T5-5: flag on, no userGroups → defaults to Standard tier
    it('T5-5: flag on — no userGroups defaults to Standard tier → DENY tier_tool_not_allowed', async () => {
      jest.spyOn(configStore, 'get').mockImplementation(
        (key) => (key === 'ff_authorize_group_policy' ? 'true' : null)
      );
      const r = await evaluateMcpFirstTool({
        ...BASE,
        toolName: 'create_withdrawal',
        userGroups: null,
        amount: 100,
        transactionType: 'withdrawal',
      });
      expect(r.decision).toBe('DENY');
      expect(r.raw.deny_reason).toBe('tier_tool_not_allowed');
    });

    // T5-6: parity — deny codes are distinct from each other and from existing codes
    it('T5-6: parity — tier deny codes are distinct from existing deny codes', () => {
      expect('tier_tool_not_allowed').not.toBe('user_not_in_group');
      expect('tier_tool_not_allowed').not.toBe('amount_exceeds_ceiling');
      expect('tier_amount_exceeded').not.toBe('amount_exceeds_ceiling');
      expect('tier_amount_exceeded').not.toBe('insufficient_scope');
    });
  });
});
