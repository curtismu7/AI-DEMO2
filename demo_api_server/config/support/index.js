/**
 * Support Agent Configuration
 * Aggregates and re-exports all support configuration modules
 */

const { buildSupportSystemPrompt } = require('./systemPrompt');
const { SUPPORT_TOOLS } = require('./tools');
const { FAQ_DATABASE } = require('./faqDatabase');

module.exports = {
  buildSupportSystemPrompt,
  SUPPORT_TOOLS,
  FAQ_DATABASE
};
