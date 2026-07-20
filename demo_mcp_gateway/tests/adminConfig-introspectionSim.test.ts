'use strict';
import { applyAdminConfigUpdate, ADMIN_CONFIG_ALLOWED_KEYS, adminConfigSafeView } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

const baseConfig = { introspectionSimDown: false } as unknown as GatewayConfig;

describe('introspectionSimDown admin config', () => {
  it('is in the allowed-keys list', () => {
    expect(ADMIN_CONFIG_ALLOWED_KEYS).toContain('introspectionSimDown');
  });

  it('rejects a non-boolean value', () => {
    const result = applyAdminConfigUpdate({ ...baseConfig }, { introspectionSimDown: 'yes' }, 'test');
    expect(result.status).toBe(400);
    expect(result.mutated).toBe(false);
  });

  it('sets the flag true in place on config', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { introspectionSimDown: true }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).introspectionSimDown).toBe(true);
  });

  it('is visible in the safe view for GET /admin/config', () => {
    const view = adminConfigSafeView({ ...baseConfig, introspectionSimDown: true } as GatewayConfig);
    expect(view.introspectionSimDown).toBe(true);
  });
});
