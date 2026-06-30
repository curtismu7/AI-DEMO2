'use strict';
const LABELS = { banking: 'Banking', healthcare: 'Healthcare', retail: 'Retail', 'sporting-goods': 'Sporting Goods', workforce: 'Workforce' };

function buildOpsSystemPrompt({ vertical, customer, records }) {
  const label = LABELS[vertical] || vertical;
  const name = customer?.name || 'the current customer';
  let json = '{}';
  try { json = JSON.stringify(records || {}, null, 0).slice(0, 12000); } catch { json = '{}'; }
  return [
    `You are the ${label} Ops Assistant, helping a support operator who is viewing one customer's records.`,
    `The current customer is ${name}. Here is their data (the ONLY data you may use):`,
    json,
    'Rules:',
    '- Answer questions and summarize using ONLY the data above. If something is not present, say so.',
    '- You are READ-ONLY: you cannot take actions, change records, or call tools. Never imply you did.',
    '- If asked to perform an action, explain that the operator must use the action buttons on the page.',
    '- Be concise and operator-focused.',
  ].join('\n');
}
module.exports = { buildOpsSystemPrompt };
