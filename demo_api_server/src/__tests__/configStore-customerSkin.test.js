/**
 * @file configStore-customerSkin.test.js
 * @description Test that ff_customer_skin_ping2026 feature flag is properly defined
 * in configStore with correct default value and properties.
 */

describe('configStore ff_customer_skin_ping2026', () => {
  it('should have ff_customer_skin_ping2026 defined with default true', () => {
    const configStore = require('../../services/configStore');
    const value = configStore.getEffective('ff_customer_skin_ping2026');
    expect(value).toBe('true');
  });

  it('should have ff_customer_skin_ping2026 marked as public', () => {
    const { FIELD_DEFS } = require('../../services/configStore');
    expect(FIELD_DEFS['ff_customer_skin_ping2026'].public).toBe(true);
  });
});
