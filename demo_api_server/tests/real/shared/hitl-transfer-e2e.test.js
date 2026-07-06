'use strict';

const { createBffClient } = require('../helpers/bffClient');
const { runHitlTransferE2e } = require('../../../scripts/run-hitl-transfer-e2e');

describe('HITL transfer E2E (real, live BFF)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('completes consent challenge flow with demo OTP 123123', async () => {
    const flagR = await client.get('/api/feature-flags');
    const hitlEnabled = flagR.data?.find?.((f) => f.id === 'ff_hitl_enabled')?.value === 'true';
    if (!hitlEnabled) {
      console.warn('[hitl-transfer-e2e] ff_hitl_enabled=false — skipping');
      return;
    }

    const result = await runHitlTransferE2e(client);
    expect(result.challengeId).toBeTruthy();
  }, 60000);
});
