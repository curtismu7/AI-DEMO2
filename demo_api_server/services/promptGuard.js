// demo_api_server/services/promptGuard.js
'use strict';

const configStore = require('./configStore');
const { validatePromptInput } = require('./promptSanitizer');

/**
 * Run prompt-injection guard when ff_prompt_injection_guard is enabled.
 * @param {string} input
 * @returns {null|{ status: number, body: object }}
 */
function guardPromptInput(input) {
  if (configStore.getEffective('ff_prompt_injection_guard') !== 'true') {
    return null;
  }
  try {
    validatePromptInput(input);
    return null;
  } catch (err) {
    return {
      status: 400,
      body: {
        error: err.code || 'prompt_blocked',
        message: err.message || 'Input blocked',
      },
    };
  }
}

module.exports = { guardPromptInput };
