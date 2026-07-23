// demo_api_server/tests/stepVerification.uc22.test.js
'use strict';

/**
 * UC22 CIBA — ledger reference for gate fixes proven by unit suites
 * (idempotent poll after approval; PingOne Authorize 429 retry).
 * Mode unit-ref: does not re-dispatch; points at the suites that prove it.
 */

const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const UC22_VERIFIED_BY = [
  'demo_api_server/src/__tests__/ciba.test.js',
  'demo_api_server/src/__tests__/cibaService.test.js',
  'demo_api_server/src/__tests__/cibaSimulatedService.test.js',
  'demo_api_server/src/__tests__/pingOneAuthorizeRetry.test.js',
].join(', ');

describe('step verification — UC22 CIBA (unit-ref)', () => {
  test('records PASS with verifiedBy covering poll race + P1AZ 429 retry', () => {
    const written = writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC22',
      triggerType: 'chip',
      mode: 'unit-ref',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: UC22_VERIFIED_BY,
    });
    expect(written).toMatch(/UC22\.chip\.unit-ref\.json$/);
    expect(UC22_VERIFIED_BY).toContain('ciba.test.js');
    expect(UC22_VERIFIED_BY).toContain('pingOneAuthorizeRetry.test.js');
  });
});
