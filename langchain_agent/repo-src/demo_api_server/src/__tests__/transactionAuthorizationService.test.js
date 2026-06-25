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
const { getAuthorizationStatusSummary } = require('../../services/transactionAuthorizationService');

describe('transactionAuthorizationService', () => {
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
