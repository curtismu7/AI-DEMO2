'use strict';

/**
 * Cross-vertical banking chip heuristics — MCP tools available on every customer
 * vertical via API_DIRECT_CHIPS. Must precede broad vertical rules that match bare
 * "account" (e.g. banking plugin accounts list).
 */
const ACCOUNT_NICKNAME_RE =
  /^account nickname$|\bnickname\b.*\baccount|\baccount\b.*\bnickname\b|\b(display\s+name|account\s+display\s+name)\b/;

const ACCOUNT_NICKNAME_HEURISTIC = {
  re: ACCOUNT_NICKNAME_RE,
  action: 'account_nickname',
};

/** True when normalized NL text targets the get_account_nickname MCP tool. */
function matchesAccountNickname(t) {
  return ACCOUNT_NICKNAME_RE.test(t);
}

module.exports = {
  ACCOUNT_NICKNAME_RE,
  ACCOUNT_NICKNAME_HEURISTIC,
  matchesAccountNickname,
};
