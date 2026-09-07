'use strict';

/**
 * The MODE→authorize-params mapping both MCP brokers depend on.
 *
 * This is the whole point of the setting: 'once' must emit `max_age` (a re-auth
 * DEADLINE, so one login covers every door that follows) and NOT `prompt=login`
 * (which re-authenticates on every door — seven doors, seven logins). Getting
 * those two confused is the bug the user actually reported.
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const configStore = require('../../services/configStore');
const mcpBrokerPrompt = require('../../services/mcpBrokerPrompt');

beforeEach(() => configStore.getEffective.mockReset());

describe('mcpBrokerPrompt.authorizeParams', () => {
  it("maps 'once' to max_age, never to prompt — one login must cover later doors", () => {
    const params = mcpBrokerPrompt.authorizeParams('once');
    expect(params).toEqual({ max_age: String(mcpBrokerPrompt.ONCE_MAX_AGE_S) });
    expect(params.prompt).toBeUndefined();
  });

  it("maps 'login' and 'select_account' to the matching prompt", () => {
    expect(mcpBrokerPrompt.authorizeParams('login')).toEqual({ prompt: 'login' });
    expect(mcpBrokerPrompt.authorizeParams('select_account')).toEqual({ prompt: 'select_account' });
  });

  it("maps 'off' to no params at all — the original silent-reuse behavior", () => {
    expect(mcpBrokerPrompt.authorizeParams('off')).toEqual({});
  });

  it('emits only params the brokers allowlist', () => {
    for (const mode of mcpBrokerPrompt.CHOICES) {
      for (const key of Object.keys(mcpBrokerPrompt.authorizeParams(mode))) {
        expect(mcpBrokerPrompt.ALLOWED_PARAMS).toContain(key);
      }
    }
  });
});

describe('mcpBrokerPrompt.effective', () => {
  it('reads the stored mode', () => {
    configStore.getEffective.mockReturnValue('select_account');
    expect(mcpBrokerPrompt.effective()).toBe('select_account');
  });

  it.each([['', 'unset'], ['   ', 'blank'], ['lgoin', 'a typo'], [undefined, 'missing']])(
    'falls back to the default, never to off, when the stored value is %p (%s)',
    (stored) => {
      configStore.getEffective.mockReturnValue(stored);
      // Falling back to 'off' would silently restore session reuse — the exact
      // failure this setting exists to prevent, and invisible when it happens.
      expect(mcpBrokerPrompt.effective()).toBe(mcpBrokerPrompt.DEFAULT);
      expect(mcpBrokerPrompt.effective()).not.toBe('off');
      expect(mcpBrokerPrompt.authorizeParams()).not.toEqual({});
    },
  );

  it("defaults to 'once' so the first door prompts and the rest ride that login", () => {
    expect(mcpBrokerPrompt.DEFAULT).toBe('once');
  });
});
