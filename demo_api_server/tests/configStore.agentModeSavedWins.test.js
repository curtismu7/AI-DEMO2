/**
 * Demo Controls > Agent mode saves through configStore.setConfig, but docker-compose
 * sets AGENT_MODE=llamacpp. getEffective() read env first, so every dropdown choice
 * was accepted (HTTP 200) and then ignored. For the runtime-toggle keys a saved
 * value now wins and the env var is only the default.
 */
'use strict';

describe('configStore agent_mode: saved choice beats the env default', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['AGENT_MODE', 'AGENT_EXTERNAL_WIRING']) saved[k] = process.env[k];
    jest.resetModules();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('uses the env var when nothing has been saved', () => {
    process.env.AGENT_MODE = 'llamacpp';
    const configStore = require('../services/configStore');
    expect(configStore.getEffective('agent_mode')).toBe('llamacpp');
  });

  it('returns the saved mode even though AGENT_MODE is set', async () => {
    process.env.AGENT_MODE = 'llamacpp';
    const configStore = require('../services/configStore');
    await configStore.setConfig({ agent_mode: 'groq' });
    expect(configStore.getEffective('agent_mode')).toBe('groq');
  });

  it('does the same for the wiring setting', async () => {
    process.env.AGENT_EXTERNAL_WIRING = 'bff';
    const configStore = require('../services/configStore');
    await configStore.setConfig({ agent_external_wiring: 'platform' });
    expect(configStore.getEffective('agent_external_wiring')).toBe('platform');
  });

  it('leaves every other key env-first', async () => {
    process.env.AI_AGENT_SCOPE = 'from-env';
    const configStore = require('../services/configStore');
    await configStore.setConfig({ ai_agent_scope: 'saved' });
    expect(configStore.getEffective('ai_agent_scope')).toBe('from-env');
    delete process.env.AI_AGENT_SCOPE;
  });
});
