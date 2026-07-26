/**
 * @file transactionAuthorizationService.test.js
 * Authorization engine summary for admin / education (no PingOne calls).
 */

jest.mock('../../services/configStore');
jest.mock('../../services/pingOneAuthorizeService', () => ({
  isConfigured: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const { getAuthorizationStatusSummary, buildStepUpBody } = require('../../services/transactionAuthorizationService');

describe('transactionAuthorizationService', () => {
  describe('buildStepUpBody — UC22 demo override', () => {
    // Proves the mechanism docs/superpowers/specs/2026-07-19-uc22-ciba-step-up-override-design.md
    // relies on: useCaseId is already threaded per-request into evaluateTransactionPolicy;
    // matching UC22's catalog slug ('ciba-out-of-band-approval') forces step_up_method
    // to 'ciba' for that one call only, regardless of the environment's configured default.
    const runtimeSettingsStub = { get: (k) => (k === 'stepUpAcrValue' ? 'Multi_factor' : undefined) };

    beforeEach(() => {
      jest.clearAllMocks();
      configStore.getEffective.mockImplementation((k) => (k === 'step_up_method' ? 'p1mfa' : null));
    });

    it('forces step_up_method: "ciba" when useCaseId matches UC22\'s demo slug', () => {
      const body = buildStepUpBody({
        useSimulated: false,
        policyId: null,
        runtimeSettings: runtimeSettingsStub,
        useCaseId: 'ciba-out-of-band-approval',
      });
      expect(body.step_up_method).toBe('ciba');
    });

    it('leaves step_up_method at the configured default for any other useCaseId', () => {
      const body = buildStepUpBody({
        useSimulated: false,
        policyId: null,
        runtimeSettings: runtimeSettingsStub,
        useCaseId: 'delegated-access-with-proof',
      });
      expect(body.step_up_method).toBe('p1mfa');
    });

    it('leaves step_up_method at the configured default when useCaseId is absent', () => {
      const body = buildStepUpBody({
        useSimulated: false,
        policyId: null,
        runtimeSettings: runtimeSettingsStub,
      });
      expect(body.step_up_method).toBe('p1mfa');
    });
  });

  describe('getAuthorizationStatusSummary', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns activeEngine off when authorize_enabled is false', () => {
      configStore.get.mockImplementation((k) => (k === 'authorize_enabled' ? 'false' : null));
      pingOneAuthorizeService.isConfigured.mockReturnValue(true);
      expect(getAuthorizationStatusSummary().activeEngine).toBe('off');
    });

    it('returns activeEngine simulated when ff_authorize_simulated is true', () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'authorize_enabled') return 'true';
        if (k === 'ff_authorize_simulated') return 'true';
        return null;
      });
      // isSimulatedModeEnabled uses getEffective (default-aware) not get
      configStore.getEffective.mockImplementation((k) => {
        if (k === 'ff_authorize_simulated') return 'true';
        return null;
      });
      pingOneAuthorizeService.isConfigured.mockReturnValue(false);
      const s = getAuthorizationStatusSummary();
      expect(s.activeEngine).toBe('simulated');
      expect(s.simulatedMode).toBe(true);
    });

    it('returns activeEngine pingone when worker configured and decision endpoint id set', () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'authorize_enabled') return 'true';
        if (k === 'ff_authorize_simulated') return 'false';
        if (k === 'authorize_decision_endpoint_id') return 'ep-123';
        return null;
      });
      // The summary resolves these via getEffective (env-aware): 'false' so
      // simulated mode is off, and the decision endpoint id so PingOne is ready.
      configStore.getEffective.mockImplementation((k) => {
        if (k === 'ff_authorize_simulated') return 'false';
        if (k === 'authorize_decision_endpoint_id') return 'ep-123';
        return null;
      });
      pingOneAuthorizeService.isConfigured.mockReturnValue(true);
      expect(getAuthorizationStatusSummary().activeEngine).toBe('pingone');
    });

    it('returns activeEngine pending_config when authorize on but not simulated and PingOne not ready', () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'authorize_enabled') return 'true';
        if (k === 'ff_authorize_simulated') return 'false';
        return null;
      });
      // isSimulatedModeEnabled uses getEffective; return 'false' so simulated mode is off
      configStore.getEffective.mockImplementation((k) => {
        if (k === 'ff_authorize_simulated') return 'false';
        return null;
      });
      pingOneAuthorizeService.isConfigured.mockReturnValue(false);
      expect(getAuthorizationStatusSummary().activeEngine).toBe('pending_config');
    });
  });
});
