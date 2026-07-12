/**
 * MFA Challenge Routes — BFF (Backend For Frontend)
 *
 * Provides endpoints for admin users to initiate and verify MFA challenges
 * before accessing protected admin pages. Delegates to the PingOne MFA test
 * integration endpoints and manages session state (mfa_verified flag).
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * Middleware: check for authenticated user
 */
function requireAuthenticatedUser(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({
      success: false,
      error: 'not_authenticated',
      message: 'Must be authenticated to access MFA challenge'
    });
  }
  next();
}

/**
 * POST /api/mfa-challenge/initiate
 *
 * Initiate an MFA challenge by delegating to the PingOne MFA test integration
 * endpoint. Passes the current session cookie to preserve authentication context.
 *
 * Response: { success: true|false, error?: string, daId?: string, devices?: [] }
 */
router.post('/initiate', requireAuthenticatedUser, async (req, res) => {
  try {
    const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/mfa/test/integration/initiate`;

    // Extract cookies from the incoming request to maintain session
    const cookies = req.headers.cookie || '';

    const response = await axios.post(
      apiUrl,
      req.body || { method: 'otp' },
      {
        headers: {
          'Cookie': cookies,
          'Content-Type': 'application/json'
        },
        withCredentials: true
      }
    );

    // Forward the response from the MFA test endpoint
    res.json(response.data);
  } catch (err) {
    console.error('[MFA Challenge] POST /initiate delegation failed:', err.message);
    const status = err.response?.status || 500;
    const errData = err.response?.data || { error: err.message };
    res.status(status).json({
      success: false,
      error: errData.error || 'initiate_failed',
      message: errData.message || err.message
    });
  }
});

/**
 * POST /api/mfa-challenge/verify
 *
 * Verify an MFA challenge by delegating to the PingOne MFA test integration
 * verify-otp endpoint. On success, sets req.session.user.mfa_verified = true
 * and returns a redirectTo URL.
 *
 * Body: { daId, deviceId, otp }
 * Response: { success: true|false, error?: string, redirectTo?: string }
 */
router.post('/verify', requireAuthenticatedUser, async (req, res) => {
  try {
    const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/mfa/test/integration/verify-otp`;

    // Extract cookies from the incoming request to maintain session
    const cookies = req.headers.cookie || '';

    const response = await axios.post(
      apiUrl,
      {
        daId: req.body?.daId,
        deviceId: req.body?.deviceId,
        otp: req.body?.otp
      },
      {
        headers: {
          'Cookie': cookies,
          'Content-Type': 'application/json'
        },
        withCredentials: true
      }
    );

    // On successful verification, set the mfa_verified flag in the session
    if (response.data?.success === true) {
      if (!req.session.user) req.session.user = {};
      req.session.user.mfa_verified = true;

      // Determine redirectTo: use session redirect hint or default to /admin
      const redirectTo = req.session.mfa_redirect_to || '/admin';

      // Clear the redirect hint after using it
      if (req.session.mfa_redirect_to) {
        delete req.session.mfa_redirect_to;
      }

      // Save session with the mfa_verified flag
      return req.session.save((err) => {
        if (err) {
          console.error('[MFA Challenge] Session save failed:', err.message);
          return res.status(500).json({
            success: false,
            error: 'session_save_failed',
            message: 'Failed to save MFA verification to session'
          });
        }

        res.json({
          success: true,
          redirectTo
        });
      });
    }

    // Forward the response if verification failed
    res.json({
      success: false,
      error: response.data?.error || 'verify_failed',
      message: response.data?.message || 'MFA verification failed'
    });
  } catch (err) {
    console.error('[MFA Challenge] POST /verify delegation failed:', err.message);
    const status = err.response?.status || 500;
    const errData = err.response?.data || { error: err.message };
    res.status(status).json({
      success: false,
      error: errData.error || 'verify_failed',
      message: errData.message || err.message
    });
  }
});

module.exports = router;
