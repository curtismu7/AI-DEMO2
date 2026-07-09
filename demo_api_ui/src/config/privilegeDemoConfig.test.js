// demo_api_ui/src/config/privilegeDemoConfig.test.js
import { describe, it, expect } from 'vitest';
import {
  PRIVILEGE_DEMO,
  privilegeConsoleUrl,
  personaConsoleUrl,
  setupStepConsoleUrl,
} from './privilegeDemoConfig';

describe('privilegeDemoConfig', () => {
  it('builds console URLs from env ids', () => {
    expect(privilegeConsoleUrl('abc-123')).toBe('https://console.pingone.com/?env=abc-123');
  });

  it('exposes shared environment ids', () => {
    expect(PRIVILEGE_DEMO.adminEnvId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(PRIVILEGE_DEMO.agentEnvId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('defines eight presenter acts with sequential numbers', () => {
    expect(PRIVILEGE_DEMO.acts).toHaveLength(8);
    expect(PRIVILEGE_DEMO.acts.map((a) => a.actNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('defines setup steps with ids', () => {
    expect(PRIVILEGE_DEMO.setupSteps.length).toBeGreaterThanOrEqual(9);
    const ids = new Set(PRIVILEGE_DEMO.setupSteps.map((s) => s.id));
    expect(ids.size).toBe(PRIVILEGE_DEMO.setupSteps.length);
  });

  it('resolves setup step console links', () => {
    const url = setupStepConsoleUrl('agentEnvId');
    expect(url).toContain(PRIVILEGE_DEMO.agentEnvId);
  });

  it('resolves persona console links', () => {
    expect(personaConsoleUrl('endUser')).toContain(PRIVILEGE_DEMO.agentEnvId);
    expect(personaConsoleUrl('platformAdmin')).toContain(PRIVILEGE_DEMO.adminEnvId);
  });

  it('includes S3 bucket resource names for fine-grained demo', () => {
    expect(PRIVILEGE_DEMO.resources.s3Bucket).toContain('bx-');
    expect(PRIVILEGE_DEMO.resources.s3BucketDenied).toContain('-1');
  });
});
