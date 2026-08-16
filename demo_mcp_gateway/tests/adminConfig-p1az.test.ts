'use strict';
import { applyAdminConfigUpdate, ADMIN_CONFIG_ALLOWED_KEYS, adminConfigSafeView } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

const baseConfig = { p1azEnabled: false } as unknown as GatewayConfig;

describe('p1azEnabled admin config', () => {
  it('is in the allowed-keys list', () => {
    expect(ADMIN_CONFIG_ALLOWED_KEYS).toContain('p1azEnabled');
  });

  it('rejects a non-boolean value (BUGS.md #52)', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { p1azEnabled: 0 }, 'test');
    expect(result.status).toBe(400);
    expect(result.mutated).toBe(false);
    // must not have silently coerced/assigned the malformed value
    expect((config as any).p1azEnabled).toBe(false);
  });

  it('sets the flag true in place on config', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { p1azEnabled: true }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).p1azEnabled).toBe(true);
  });

  it('sets the flag false in place on config', () => {
    const config = { ...baseConfig, p1azEnabled: true } as GatewayConfig;
    const result = applyAdminConfigUpdate(config, { p1azEnabled: false }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).p1azEnabled).toBe(false);
  });

  it('is visible in the safe view for GET /admin/config', () => {
    const view = adminConfigSafeView({ ...baseConfig, p1azEnabled: true } as GatewayConfig);
    expect(view.p1azEnabled).toBe(true);
  });
});
