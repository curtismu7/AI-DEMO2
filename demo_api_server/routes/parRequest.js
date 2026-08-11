'use strict';

/**
 * PAR (Pushed Authorization Request) Routes
 * RFC 9126 compliant - client-initiated authorization request
 */

const express = require('express');
const router = express.Router();

/**
 * Push an authorization request for later retrieval.
 * Client sends authorization parameters and receives a request_uri for later use.
 *
 * @flow par
 * @name PAR
 * @rfc https://datatracker.ietf.org/doc/html/rfc9126 RFC 9126
 * @actor client-app
 * @to auth-server
 * @step 1
 */
router.post('/par', express.json(), (req, res) => {
  try {
    const { client_id, scope, redirect_uri, state, code_challenge, code_challenge_method } = req.body;

    if (!client_id || !redirect_uri) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and redirect_uri are required'
      });
    }

    // Generate a request_uri for this pushed request
    const request_uri = `urn:par:${Buffer.from(JSON.stringify(req.body)).toString('hex').substring(0, 32)}`;
    const expires_in = 900; // 15 minutes

    res.json({
      request_uri,
      expires_in
    });
  } catch (error) {
    console.error('[PAR] Error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * Authorize a pushed authorization request.
 * Authorization server processes the request_uri and issues authorization code.
 *
 * @flow par
 * @actor auth-server
 * @to client-app
 * @step 2
 */
router.get('/authorize', (req, res) => {
  try {
    const { request_uri, client_id } = req.query;

    if (!request_uri || !client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'request_uri and client_id are required'
      });
    }

    // In a real implementation, look up the pushed request using request_uri
    const authorization_code = Buffer.from(Math.random().toString()).toString('base64').substring(0, 32);

    res.json({
      code: authorization_code,
      state: req.query.state || undefined
    });
  } catch (error) {
    console.error('[PAR Authorize] Error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

module.exports = router;
