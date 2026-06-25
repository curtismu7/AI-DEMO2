/**
 * Token Compliance Audit — RFC 8693 validation endpoint
 *
 * GET /api/admin/token-compliance
 *   → Returns validation report for current session's token claims
 *
 * Depends on: validateTokenStructure() from Phase 188 Wave 1
 * See: docs/RFC8693_MCP_VALIDATION_MATRIX.md for full compliance mapping
 */
const express = require('express');
const router = express.Router();
const { validateTokenStructure } = require('../services/tokenStructureValidator');

/**
 * Decode JWT payload (base64url) without verification — claims-only inspection.
 * @param {string} jwt
 * @returns {object|null}
 */
function decodePayload(jwt) {
  if (!jwt || typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/token-compliance
 *
 * Validates the current session's access token(s) against RFC 8693 requirements.
 * Returns a compliance report with pass/fail checks.
 */
router.get('/', (req, res) => {
  const report = {
    compliant: true,
    checks: [],
    timestamp: new Date().toISOString(),
    sessionPresent: false,
  };

  // Check if session and tokens exist
  const accessToken = req.session?.oauthTokens?.accessToken;
  if (!accessToken) {
    report.compliant = false;
    report.checks.push({
      name: 'Session Token Present',
      status: 'fail',
      rfc: 'N/A',
      detail: 'No access token in session — user may not be authenticated',
    });
    return res.json(report);
  }

  report.sessionPresent = true;

  // Decode and validate the user's access token (subject token per RFC 8693 §2.1)
  const claims = decodePayload(accessToken);
  if (!claims) {
    report.compliant = false;
    report.checks.push({
      name: 'Token Decodable',
      status: 'fail',
      rfc: 'RFC 7519',
      detail: 'Access token could not be decoded as JWT',
    });
    return res.json(report);
  }

  // Run RFC 8693 structural validation
  const validation = validateTokenStructure(claims, {
    isDelegationFlow: false, // Subject token itself is not a delegation token
  });

  // Map validation results to compliance checks
  for (const error of validation.errors) {
    report.compliant = false;
    report.checks.push({
      name: error.split(':')[0]?.trim() || 'Validation',
      status: 'fail',
      rfc: error.match(/RFC \d+ §[\d.]+/)?.[0] || 'RFC 8693',
      detail: error,
    });
  }

  for (const warning of validation.warnings) {
    report.checks.push({
      name: warning.split(':')[0]?.trim() || 'Validation',
      status: 'warn',
      rfc: warning.match(/RFC \d+ §[\d.]+/)?.[0] || 'RFC 8693',
      detail: warning,
    });
  }

  // Additional checks beyond validateTokenStructure
  // Check may_act claim (RFC 8693 §4.1) — needed for delegation
  if (claims.may_act) {
    report.checks.push({
      name: 'may_act Present',
      status: 'pass',
      rfc: 'RFC 8693 §4.1',
      detail: `may_act.sub = ${claims.may_act?.sub || '(missing sub)'}`,
    });
  } else {
    report.checks.push({
      name: 'may_act Absent',
      status: 'warn',
      rfc: 'RFC 8693 §4.1',
      detail: 'No may_act claim — delegation exchange may be rejected by PingOne',
    });
  }

  // If all structural checks passed, add a summary pass
  if (validation.valid && validation.errors.length === 0) {
    report.checks.unshift({
      name: 'RFC 8693 Structure',
      status: 'pass',
      rfc: 'RFC 8693 §3.2',
      detail: `Token has required claims: sub=${claims.sub?.substring(0, 8)}..., aud present, exp valid`,
    });
  }

  console.log(`[token-compliance] Audit: compliant=${report.compliant}, checks=${report.checks.length}`);
  res.json(report);
});

module.exports = router;
