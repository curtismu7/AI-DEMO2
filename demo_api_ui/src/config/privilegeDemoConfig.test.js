// demo_api_ui/src/config/privilegeDemoConfig.test.js
import { describe, it, expect } from 'vitest';
import {
  PRIVILEGE_DEMO,
  privilegeConsoleUrl,
  personaConsoleUrl,
} from './privilegeDemoConfig';

describe('privilegeDemoConfig', () => {
  it('builds console URLs from env ids', () => {
    expect(privilegeConsoleUrl('abc-123')).toBe('https://console.pingone.com/?env=abc-123');
  });

  it('exposes the shared agent environment id', () => {
    expect(PRIVILEGE_DEMO.agentEnvId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('points to the SE1 shared-demo guide', () => {
    expect(PRIVILEGE_DEMO.overview.length).toBeGreaterThan(40);
    expect(PRIVILEGE_DEMO.se1GuidePath).toContain('SE1-Privilege-Shared-Demo.md');
    expect(PRIVILEGE_DEMO.se1GuideUrl).toContain('SE1-Privilege-Shared-Demo.md');
  });

  it('resolves persona console links', () => {
    expect(personaConsoleUrl('endUser')).toContain(PRIVILEGE_DEMO.agentEnvId);
    expect(personaConsoleUrl('platformAdmin')).toContain(PRIVILEGE_DEMO.personas.platformAdmin.envId);
  });
});
