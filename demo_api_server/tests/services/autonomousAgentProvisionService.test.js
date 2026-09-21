'use strict';

const {
  AGENT_DEFINITIONS,
  planAutonomousAgentProvisioning,
  provisionAutonomousAgents,
} = require('../../services/autonomousAgentProvisionService');

describe('autonomousAgentProvisionService', () => {
  test('declares one isolated web application identity per unattended job', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(2);
    expect(AGENT_DEFINITIONS.map((a) => a.name)).toEqual([
      'Super Banking Fraud Watch Agent',
      'Super Banking Balance Sweep Agent',
    ]);
    for (const def of AGENT_DEFINITIONS) {
      expect(def.type).toBe('AI_AGENT');
      expect(def.grantTypes).toEqual(['CLIENT_CREDENTIALS']);
      expect(def.configPrefix).toMatch(/^pingone_/);
    }
  });

  test('dry-run returns deterministic actions without requiring PingOne credentials', async () => {
    const result = await provisionAutonomousAgents({ dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ action: 'ensure_application', name: AGENT_DEFINITIONS[0].name });
    expect(result.actions[0].configKeys).toEqual([
      'pingone_fraud_watch_agent_client_id',
      'pingone_fraud_watch_agent_client_secret',
    ]);
  });

  test('plans an update when an existing app has drift', () => {
    const result = planAutonomousAgentProvisioning({
      existing: [{ name: AGENT_DEFINITIONS[0].name, type: 'AI_AGENT', grantTypes: [] }],
    });
    expect(result.actions[0].action).toBe('update_application');
  });

  test('applies definitions through the injected provisioning service and stores credentials', async () => {
    const calls = [];
    const service = {
      async createApplication(...args) {
        calls.push(['createApplication', ...args]);
        return { application: { id: `id-${calls.length}`, clientId: `client-${calls.length}` }, exists: false };
      },
      async getApplicationSecret(id) { return `secret-${id}`; },
    };
    const configStore = { setConfig: jest.fn(async (value) => value) };
    const result = await provisionAutonomousAgents({ dryRun: false, service, configStore });
    expect(result.applied).toBe(true);
    expect(calls).toHaveLength(2);
    expect(configStore.setConfig).toHaveBeenCalledWith(expect.objectContaining({
      pingone_fraud_watch_agent_client_id: 'client-1',
      pingone_fraud_watch_agent_client_secret: 'secret-id-1',
    }));
  });
});
