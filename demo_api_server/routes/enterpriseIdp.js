'use strict';

/**
 * enterpriseIdp.js — demo Enterprise IdP for MCP Enterprise-Managed Authorization.
 *
 * PingOne does not yet issue ID-JAG assertions, so this endpoint performs the
 * signing step only. PingOne remains the authority for identity and group policy:
 * enterpriseMcpPolicyService.checkPolicy is what decides PERMIT/DENY here.
 *
 * The policy gate runs BEFORE minting on purpose. The extension requires that a
 * client never receive a token for a server it is not authorized for, so a denied
 * user gets an OAuth error and no assertion at all.
 *
 * @see docs/superpowers/specs/2026-08-22-enterprise-managed-mcp-authorization-design.md
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const router = express.Router();
const configStore = require('../services/configStore');
const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
const enterpriseIdpKey = require('../services/enterpriseIdpKey');

const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_JAG_LIFETIME_SECONDS = 120;

/** Public JWKS so the MCP Authorization Server can verify our assertions. */
router.get('/jwks', (_req, res) => {
  res.json({ keys: [enterpriseIdpKey.getPublicJwk()] });
});

/**
 * RFC 8693 exchange issuing an ID-JAG.
 * Body: grant_type, requested_token_type, subject_token, subject_token_type,
 *       audience (MCP AS issuer), resource (MCP server), scope.
 */
router.post('/token', express.json(), async (req, res) => {
  try {
    const { grant_type, requested_token_type, subject_token, audience, resource, scope } = req.body || {};

    if (grant_type !== TOKEN_EXCHANGE_GRANT || requested_token_type !== ID_JAG_TOKEN_TYPE || !subject_token || !audience) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'grant_type=...token-exchange, requested_token_type=...id-jag, subject_token and audience are required',
      });
    }

    const user = req.session && req.session.user;
    if (!user || !user.oauthId) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'No signed-in user for this exchange.' });
    }

    // Checked before the policy call on purpose: an unapproved resource is a bad
    // request regardless of who is asking, and evaluating policy first would leak
    // a group-membership answer for a server we do not serve.
    if (resource) {
      const allowed = enterpriseMcpPolicy.getAllowedResourceUris();
      if (allowed.length && !allowed.includes(resource)) {
        return res.status(400).json({
          error: 'invalid_target',
          error_description: `resource ${resource} is not an approved MCP server.`,
        });
      }
    }

    const policy = await enterpriseMcpPolicy.checkPolicy(req);
    if (!policy.allowed) {
      return res.status(policy.httpStatus || 403).json({
        error: 'access_denied',
        error_description: policy.message || 'Enterprise MCP policy denied.',
        code: policy.code || 'enterprise_mcp_policy_denied',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const idJag = jwt.sign(
      {
        jti: crypto.randomUUID(),
        iss: configStore.getEffective('enterprise_idp_issuer') || '',
        sub: user.oauthId,
        ...(user.email ? { email: user.email } : {}),
        aud: audience,
        ...(resource ? { resource } : {}),
        client_id: req.body.client_id || 'demo-bff-mcp-client',
        iat: now,
        exp: now + ID_JAG_LIFETIME_SECONDS,
        scope: scope || '',
      },
      enterpriseIdpKey.getPrivateKeyPem(),
      { algorithm: 'RS256', header: { alg: 'RS256', typ: 'oauth-id-jag+jwt', kid: enterpriseIdpKey.getKid() } },
    );

    return res.json({
      issued_token_type: ID_JAG_TOKEN_TYPE,
      access_token: idJag,
      token_type: 'N_A',
      expires_in: ID_JAG_LIFETIME_SECONDS,
    });
  } catch (err) {
    console.error('[enterpriseIdp] /token failed:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: err.message });
  }
});

module.exports = router;
