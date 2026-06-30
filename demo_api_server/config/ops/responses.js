'use strict';

const { getMessage } = require('./messages');

const REASON_CODES = {
  unknown: 'The Ops Assistant is temporarily unavailable. Please try again shortly.',
  llm_timeout: 'The reasoning service is slow. Please try again.',
  mcp_error: 'Could not reach data sources. Refresh and try again.',
  json_serialize: 'Failed to process customer records. Please refresh.',
  context_overflow: 'Customer data is too large to process. Contact support.',
};

module.exports = {
  noCustomer: function(locale = 'en') {
    return {
      userMessage: getMessage('errors.noCustomer', locale),
      code: 'NO_CUSTOMER_LOADED',
    };
  },

  reasoningUnavailable: function(reason = 'unknown', locale = 'en') {
    return {
      userMessage: REASON_CODES[reason] || REASON_CODES.unknown,
      code: 'REASONING_UNAVAILABLE_' + reason.toUpperCase(),
      operatorNote: '[reason: ' + reason + ']',
    };
  },
};
