// demo_api_server/services/promptSanitizer.js

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /execute\s+code/i,
  /override\s+(security|auth|permission|access)/i,
  /grant\s+(admin|superuser|elevated)/i,
  /bypass\s+(auth|mfa|consent|hitl)/i,
  /disable\s+(security|mfa|consent|audit)/i,
];

const MAX_INPUT_LENGTH = 5000;

function validatePromptInput(input) {
  if (!input || typeof input !== 'string') {
    return input;
  }

  // Check length limit
  if (input.length > MAX_INPUT_LENGTH) {
    const error = new Error(`Input exceeds maximum length (${MAX_INPUT_LENGTH} chars)`);
    error.code = 'input_too_long';
    throw error;
  }

  // Check injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      const error = new Error('Input contains blocked pattern — possible prompt injection');
      error.code = 'injection_pattern_matched';
      error.blockedPattern = pattern.toString();
      error.inputPreview = input.length > 200 ? input.substring(0, 200) + '...' : input;
      throw error;
    }
  }

  return input;
}

module.exports = {
  validatePromptInput,
  INJECTION_PATTERNS,
  MAX_INPUT_LENGTH,
};
