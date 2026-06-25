'use strict';

// Shared education heuristics: API key and dual-token demo paths
// These are available from any vertical's agent
const EDUCATION_HEURISTICS = [
  // api_key_demo
  { re: /(?:show|get|use)?\s*(?:special\s+)?offers?|\bpromotions?\b|\bapi[- ]?key\s+path\b/i, action: 'api_key_demo' },
  // dual_token_demo
  { re: /(?:show|view|my)?\s*profile\s*card|\baccess[- ]?(?:and[- ]?)?id[- ]?token\s+path\b|\bdual[- ]?token\s+path\b/i, action: 'dual_token_demo' },
];

module.exports = { EDUCATION_HEURISTICS };
