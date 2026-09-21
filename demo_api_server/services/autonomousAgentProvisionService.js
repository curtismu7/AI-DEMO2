'use strict';

const configStoreDefault = require('./configStore');
const { PingOneProvisionService } = require('./pingoneProvisionService');

const AGENT_DEFINITIONS = Object.freeze([
  {
    name: 'Super Banking Fraud Watch Agent',
    description: 'Autonomous read-only fraud watch agent for unattended demo runs.',
    configPrefix: 'pingone_fraud_watch_agent',
    type: 'AI_AGENT',
    grantTypes: ['CLIENT_CREDENTIALS'],
  },
  {
    name: 'Super Banking Balance Sweep Agent',
    description: 'Autonomous balance sweep agent for unattended demo runs.',
    configPrefix: 'pingone_balance_sweep_agent',
    type: 'AI_AGENT',
    grantTypes: ['CLIENT_CREDENTIALS'],
  },
]);

function definitionAction(definition, existing) {
  if (!existing) return { action: 'ensure_application', name: definition.name, configKeys: [
    `${definition.configPrefix}_client_id`, `${definition.configPrefix}_client_secret`,
  ] };
  if (existing.type !== definition.type) return { action: 'recreate_application', name: definition.name };
  const grants = new Set((existing.grantTypes || []).map((g) => String(g).toUpperCase()));
  if (grants.size !== definition.grantTypes.length || definition.grantTypes.some((g) => !grants.has(g))) {
    return { action: 'update_application', name: definition.name, grantTypes: definition.grantTypes };
  }
  return { action: 'reuse_application', name: definition.name };
}

function planAutonomousAgentProvisioning({ existing = [] } = {}) {
  return {
    actions: AGENT_DEFINITIONS.map((definition) => definitionAction(
      definition,
      existing.find((app) => app.name === definition.name),
    )),
  };
}

async function provisionAutonomousAgents({
  dryRun = true,
  service = null,
  configStore = configStoreDefault,
} = {}) {
  if (dryRun) {
    return { applied: false, ...planAutonomousAgentProvisioning() };
  }
  const provisioner = service || new PingOneProvisionService();
  const results = [];
  const config = {};
  for (const definition of AGENT_DEFINITIONS) {
    const result = await provisioner.createApplication(
      definition.name,
      definition.description,
      definition.type,
      definition.grantTypes,
      'CLIENT_SECRET_POST',
    );
    const app = result.application;
    const secret = await provisioner.getApplicationSecret(app.id);
    if (!app?.clientId || !secret) throw new Error(`PingOne did not return credentials for ${definition.name}`);
    config[`${definition.configPrefix}_client_id`] = app.clientId;
    config[`${definition.configPrefix}_client_secret`] = secret;
    results.push({ name: definition.name, id: app.id, clientId: app.clientId, exists: result.exists === true });
  }
  await configStore.setConfig(config);
  return { applied: true, results, configKeys: Object.keys(config) };
}

module.exports = { AGENT_DEFINITIONS, planAutonomousAgentProvisioning, provisionAutonomousAgents };
