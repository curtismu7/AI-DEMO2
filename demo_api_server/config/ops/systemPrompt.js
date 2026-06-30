'use strict';
const { OPS_ASSISTANT } = require('./constants');

const LABELS = { banking: 'Banking', healthcare: 'Healthcare', retail: 'Retail', 'sporting-goods': 'Sporting Goods', workforce: 'Workforce' };

function buildOpsSystemPrompt({ vertical, customer, records }) {
  let json = '{}';
  try {
    const stringified = JSON.stringify(records || {}, null, 0);
    json = stringified.length > OPS_ASSISTANT.MAX_RECORDS_JSON_CHARS
      ? stringified.slice(0, OPS_ASSISTANT.MAX_RECORDS_JSON_CHARS)
      : stringified;
  } catch (_) {
    json = '{}';
  }

  return `You are the ${LABELS[vertical] || vertical} Ops Assistant, helping a support operator who is viewing one customer's records.
The current customer is ${(customer && customer.name) || 'the current customer'}. Here is their data (the ONLY data you may use):
${json}
Rules:
- Answer questions and summarize using ONLY the data above. If something is not present, say so.
- You are READ-ONLY: you cannot take actions, change records, or call tools. Never imply you did.
- If asked to perform an action, explain that the operator must use the action buttons on the page.
- Be concise and operator-focused.`;
}

module.exports = { buildOpsSystemPrompt };
