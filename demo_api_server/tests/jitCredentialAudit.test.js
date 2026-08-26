'use strict';

/**
 * Every credential issuance leaves an audit record.
 *
 * Without this, a minted credential is invisible: the broker refusal path logs,
 * but a SUCCESSFUL issue writes nothing, so "which agent got a credential for
 * which tool, when" is unanswerable after the fact. That is the question an
 * audit trail exists to answer.
 *
 * The record carries metadata only. Writing the credential value into a
 * 5000-event durable store would turn the audit log into a place where
 * short-lived secrets live for a long time -- the opposite of the point.
 */
jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
jest.mock('../services/killSwitchService', () => ({ isAgentRevoked: jest.fn() }));
jest.mock('../services/lmdb/mcpAuditStore.lmdb', () => ({ append: jest.fn() }));

const configStore = require('../services/configStore');
const killSwitchService = require('../services/killSwitchService');
const auditStore = require('../services/lmdb/mcpAuditStore.lmdb');
const broker = require('../services/jitCredentialBroker');

const FAKE_BACKEND_KEY = 'not-a-secret-test-fixture';

const mint = (over = {}) => broker.mintCredential({
  keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
  tool: 'show_mortgage',
  aud: 'mortgage',
  requester: 'ping-gateway',
  ...over,
});

describe('credential issuance is audited', () => {
  beforeEach(() => {
    configStore.getEffective.mockReset();
    killSwitchService.isAgentRevoked.mockReset();
    auditStore.append.mockReset();
    configStore.getEffective.mockReturnValue(FAKE_BACKEND_KEY);
    killSwitchService.isAgentRevoked.mockResolvedValue(false);
  });

  test('writes one record naming the tool, route, requester and jti', async () => {
    const minted = await mint();

    expect(auditStore.append).toHaveBeenCalledTimes(1);
    const rec = auditStore.append.mock.calls[0][0];
    expect(rec).toMatchObject({
      eventType: 'credential_issued',
      tool: 'show_mortgage',
      aud: 'mortgage',
      requester: 'ping-gateway',
      keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
      jti: minted.jti,
      outcome: 'success',
    });
  });

  test('never records the credential value itself', async () => {
    const minted = await mint();

    const serialized = JSON.stringify(auditStore.append.mock.calls[0][0]);
    expect(serialized).not.toContain(minted.value);
    // Nor the signing secret it was minted from.
    expect(serialized).not.toContain(FAKE_BACKEND_KEY);
  });

  test('records a refusal, so a revoked agent leaves a trail too', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValue(true);

    await expect(mint({ requester: 'agent-42' })).rejects.toMatchObject({ code: 'requester_revoked' });

    expect(auditStore.append).toHaveBeenCalledTimes(1);
    expect(auditStore.append.mock.calls[0][0]).toMatchObject({
      eventType: 'credential_issued',
      outcome: 'refused',
      reason: 'requester_revoked',
      requester: 'agent-42',
    });
  });

  test('an audit-store failure never blocks issuance', async () => {
    // Fire-and-forget, matching gatewayAudit: losing an audit write must not
    // take out the request path it is observing.
    auditStore.append.mockImplementation(() => { throw new Error('lmdb down'); });

    const minted = await mint();
    expect(minted.value).toBeTruthy();
  });
});
