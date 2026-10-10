'use strict';
import { applyAdminConfigUpdate, ADMIN_CONFIG_ALLOWED_KEYS, adminConfigSafeView } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

const baseConfig = { jwksSimDown: false } as unknown as GatewayConfig;

describe('jwksSimDown admin config (UC29 outage sim)', () => {
  it('is in the allowed-keys list', () => {
    expect(ADMIN_CONFIG_ALLOWED_KEYS).toContain('jwksSimDown');
  });

  it('rejects a non-boolean value', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { jwksSimDown: 0 }, 'test');
    expect(result.status).toBe(400);
    expect(result.mutated).toBe(false);
    expect((config as any).jwksSimDown).toBe(false);
  });

  it('sets the flag true in place on config', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { jwksSimDown: true }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).jwksSimDown).toBe(true);
  });

  it('sets the flag false in place on config', () => {
    const config = { ...baseConfig, jwksSimDown: true } as GatewayConfig;
    const result = applyAdminConfigUpdate(config, { jwksSimDown: false }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).jwksSimDown).toBe(false);
  });

  it('is visible in the safe view for GET /admin/config', () => {
    const view = adminConfigSafeView({ ...baseConfig, jwksSimDown: true } as GatewayConfig);
    expect(view.jwksSimDown).toBe(true);
  });
});
