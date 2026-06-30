'use strict';

const MESSAGES = {
  errors: {
    noCustomer: {
      en: 'No customer is loaded yet. Look up a customer first, then ask me about them.',
    },
    reasoningUnavailable: {
      en: 'The Ops Assistant is temporarily unavailable. Please try again shortly.',
    },
  },
  info: {
    recordsTruncated: {
      en: '[Note: customer data was truncated to fit context; showing most recent records]',
    },
  },
};

function getMessage(path, locale = 'en') {
  const keys = path.split('.');
  let value = MESSAGES;
  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = value[key];
    } else {
      return null;
    }
  }
  return (value && value[locale]) || (value && value.en) || null;
}

module.exports = {
  MESSAGES,
  getMessage,
};
