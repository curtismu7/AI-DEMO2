/**
 * Regression: SIMULATED_AUTHORIZE_CONSENT_TYPES explicitly set to '' must mean
 * "no type-based consent" (amount thresholds still govern). Guards the falsy-
 * fallback bug where '' fell through to the 'transfer' default, making the
 * type rule impossible to turn off — every $100 agent transfer 428'd even
 * though the demo's consent tier starts at the confirm-amount threshold.
 */
'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn(),
}));

const configStore = require('../services/configStore');
const { getConsentTypes } = require('../services/simulatedAuthorizeService');

describe('getConsentTypes empty-value semantics', () => {
  const savedEnv = process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES;
    else process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES = savedEnv;
  });

  test("explicit '' in configStore disables type-based consent", () => {
    configStore.get.mockReturnValue('');
    expect(getConsentTypes().size).toBe(0);
  });

  test("unset everywhere falls back to the 'transfer' default", () => {
    configStore.get.mockReturnValue(undefined);
    delete process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES;
    expect([...getConsentTypes()]).toEqual(['transfer']);
  });

  test('configStore value overrides the default', () => {
    configStore.get.mockReturnValue('withdrawal');
    expect([...getConsentTypes()]).toEqual(['withdrawal']);
  });

  test("explicit '' in env (configStore unset) disables type-based consent", () => {
    configStore.get.mockReturnValue(undefined);
    process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES = '';
    expect(getConsentTypes().size).toBe(0);
  });
});
