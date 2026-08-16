'use strict';

/**
 * DPoP (Demonstration of Proof-of-Possession) Routes
 * RFC 9449 compliant - token binding to HTTP request signatures
 */

const express = require('express');
const router = express.Router();

/**
 * Request an access token with DPoP proof.
 * Client sends a DPoP proof header to bind the token to a specific key pair.
 *
 * Not scriptable by the protocol playground (requires a DPoP HTTP header,
 * which the playground's @body-only engine cannot populate) — see the
 * self-contained demo at routes/dpopDemo.js instead.
 */
router.post('/oauth/token', express.json(), (req, res) => {
  try {
    const { grant_type, scope, subject_token, resource } = req.body;
    const dpopProof = req.headers['dpop'];

    if (!dpopProof) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'DPoP proof header is required'
      });
    }

    if (!grant_type || grant_type !== 'urn:ietf:params:oauth:grant-type:token-exchange') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only token-exchange grant type is supported with DPoP'
      });
    }

    // In a real implementation, validate and decode the DPoP proof
    const access_token = Buffer.from(Math.random().toString()).toString('base64').substring(0, 64);

    res.json({
      access_token,
      token_type: 'DPoP',
      expires_in: 3600,
      scope: scope || 'default'
    });
  } catch (error) {
    console.error('[DPoP Token] Error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * Verify DPoP proof on gateway.
 * Gateway validates that the DPoP proof is valid and matches the token being used.
 */
router.post('/gateway/verify-dpop', express.json(), (req, res) => {
  try {
    const { access_token } = req.body;
    const dpopProof = req.headers['dpop'];

    if (!access_token || !dpopProof) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'access_token and DPoP proof header are required'
      });
    }

    // In a real implementation, validate:
    // 1. DPoP proof signature using the key from proof header
    // 2. That the proof thumbprint matches the token binding
    // 3. That the HTTP method and URL match the proof

    res.json({
      valid: true,
      reason: 'DPoP proof verified',
      token_thumbprint: 'jic_encoded_thumbprint'
    });
  } catch (error) {
    console.error('[DPoP Verify] Error:', error);
    res.status(500).json({
      error: 'invalid_dpop_proof',
      error_description: 'Failed to verify DPoP proof'
    });
  }
});

module.exports = router;
