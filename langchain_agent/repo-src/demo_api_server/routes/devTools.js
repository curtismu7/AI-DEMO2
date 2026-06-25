'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path = require('path');
const { requireSession } = require('../middleware/auth');

const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '../../');

let activeLaunch = false;

const runServersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.session?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', message: 'Too many restart requests. Try again in 1 minute.' },
});

router.post('/run-servers', requireSession, runServersLimiter, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'forbidden', message: 'Run Servers is not available in production.' });
  }

  if (activeLaunch) {
    return res.status(409).json({ error: 'already_running', message: 'Already starting, please wait.' });
  }

  activeLaunch = true;
  setTimeout(() => { activeLaunch = false; }, 60_000);

  // Use osascript to open a real Terminal window with a full GUI session.
  // This gives run-demo.sh a TTY so CRA's npm start can open the browser,
  // identical to running ./run-demo.sh restart in a terminal manually.
  const osa = `tell application "Terminal"
    activate
    do script "cd ${REPO_ROOT} && ./run-demo.sh restart"
  end tell`;

  const proc = spawn('osascript', ['-e', osa], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  res.status(202).json({ message: 'Opening Terminal to restart servers.' });
});

router.post('/intent-bypass-demo', requireSession, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'forbidden', message: 'Not available in production.' });
  }

  const { mintIntentToken } = require('../services/intentTokenService');
  const { resolveMcpAccessTokenWithEvents, buildTokenEvent, decodeJwtClaims } = require('../services/agentMcpTokenService');
  const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');

  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'login_required', message: 'Must be logged in to run this demo.' });
  }

  const FAKE_INTENT = 'view_balance';
  const ATTACK_TOOL = 'create_transfer';

  try {
    // Mint a MISMATCHED Intent Token (view_balance permitted_tools, but we'll call create_transfer)
    const { token: intentToken } = mintIntentToken({
      userId,
      sessionId: req.sessionID,
      prompt:    'Show me my account balance',
      intent:     FAKE_INTENT,
      confidence: 0.97,
      vertical:  'banking',
    });
    req.intentToken = intentToken;
    const itDecoded = decodeJwtClaims(intentToken);
    const permittedTools = itDecoded?.claims?.permitted_tools ?? [];

    const itEvent = buildTokenEvent(
      'intent-token',
      `Intent Token — view_balance bound (ATTACK: attempting ${ATTACK_TOOL})`,
      'active',
      itDecoded,
      `Attack scenario: the Intent Token was minted for intent="${FAKE_INTENT}" ` +
      `(permitted_tools=[${permittedTools.join(', ')}]) but the agent is attempting to call ` +
      `"${ATTACK_TOOL}" — which is NOT in permitted_tools. The MCP gateway will detect this ` +
      `mismatch via the mock authz server Rule 4b (IntentTokenValid=true, IntentMatchesTool=false).`,
      {
        rfc:            'draft-ietf-oauth-intent-token',
        intent:          FAKE_INTENT,
        confidence:      0.97,
        permitted_tools: permittedTools,
      }
    );

    // Resolve a gateway-scoped token via the normal exchange pipeline
    const resolved = await resolveMcpAccessTokenWithEvents(req, ATTACK_TOOL);
    if (!resolved.token) {
      return res.status(401).json({
        error:       'token_exchange_failed',
        message:     'Could not resolve MCP access token — try logging out and back in.',
        tokenEvents: [itEvent, ...(resolved.tokenEvents || [])],
      });
    }

    const tokenEvents = [itEvent, ...(resolved.tokenEvents || [])];

    // Call the gateway with a real token but the mismatched IT — expect 403 intent_mismatch
    try {
      await callToolViaGateway(
        getMcpGatewayHttpUrl(),
        resolved.token,
        ATTACK_TOOL,
        {},
        { intentToken }
      );
      return res.status(200).json({
        unexpected:  true,
        message:    'Gateway did not deny the call — intent enforcement may be disabled.',
        tokenEvents,
      });
    } catch (gwErr) {
      if (gwErr.httpStatus === 403) {
        tokenEvents.push(buildTokenEvent(
          'gw-intent-deny',
          `Gateway — 403 intent_mismatch (Attack Blocked)`,
          'failed',
          null,
          `The MCP gateway detected that the Intent Token was minted for intent="${FAKE_INTENT}" ` +
          `(permitted_tools=[${permittedTools.join(', ')}]) but the actual tool call was ` +
          `"${ATTACK_TOOL}". Mock authz server Rule 4b: IntentTokenValid=true, ` +
          `IntentMatchesTool=false → DENY "${gwErr.gatewayErrorCode || 'intent_mismatch'}". ` +
          `The agent cannot widen its own authorization after the prompt is bound at the BFF.`,
          {
            gatewayDecision: 'DENY',
            gatewayErrorCode: gwErr.gatewayErrorCode || 'intent_mismatch',
          }
        ));
        return res.status(403).json({
          error:           'intent_mismatch_demo',
          message:        `Gateway denied: "${ATTACK_TOOL}" not permitted for intent "${FAKE_INTENT}"`,
          attackDemo:      true,
          gatewayDecision: 'DENY',
          tokenEvents,
        });
      }
      throw gwErr;
    }
  } catch (err) {
    console.error('[dev/intent-bypass-demo] Unexpected error:', err.message);
    return res.status(500).json({ error: 'demo_failed', message: err.message });
  }
});

module.exports = router;
