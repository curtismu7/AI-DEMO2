'use strict';

// Run-gate failures of the live PF ID-JAG demo (assertPfIdJagRunAllowed). Each is
// a 401 that must reach the client as-is, never degrade into an ordinary tool call.
const ID_JAG_GATE_CODES = new Set([
  'id_jag_login_required',
  'id_jag_provider_required',
  'id_jag_provider_mismatch',
]);

const isIdJagGateCode = (code) => ID_JAG_GATE_CODES.has(code);

module.exports = { isIdJagGateCode };
