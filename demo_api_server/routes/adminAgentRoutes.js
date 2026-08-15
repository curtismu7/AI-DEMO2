'use strict';

const express = require('express');
const crypto = require('crypto');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');
const { processAdminMessage } = require('../services/adminAgentService');
const { buildAdminToolSchemas } = require('../config/admin/tools');
const appEventService = require('../services/appEventService');
const { prependRefreshEvent } = require('../services/agentMcpTokenService');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const pingOneAdminAccessService = require('../services/pingOneAdminAccessService');

const router = express.Router();
router.use(agentSessionMiddleware);
router.use(requestEventEmitterMiddleware);

async function requirePingOneAdminGroup(req, res, response = {}) {
  const access = await pingOneAdminAccessService.checkAccess({
    username: req.session?.user?.username || null,
    pingOneUserId: req.agentContext?.userId || null,
    accessToken: req.agentContext?.accessToken || null,
  });
  if (access.allowed) return true;

  const lookupUnavailable = access.status === 503;
  res.status(access.status).json({
    ...response,
    error: access.error,
    message: lookupUnavailable
      ? `Could not verify membership in '${access.requiredGroup}'.`
      : `Membership in '${access.requiredGroup}' is required to use the PingOne Admin Assistant.`,
    reply: lookupUnavailable
      ? `I could not verify your '${access.requiredGroup}' group membership. Try again after PingOne is available.`
      : `Access denied. Add the signed-in user to '${access.requiredGroup}', then run the query again.`,
    requiredGroup: access.requiredGroup,
    success: false,
  });
  return false;
}

// POST /init — Validate admin session and return available PingOne tools.
// Admin uses the worker client_credentials token (no CC token exchange needed).
router.post('/init', async (req, res) => {
  try {
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }
    if (!await requirePingOneAdminGroup(req, res, {
      initialized: true,
      agentConfigured: true,
      agentReady: false,
      availableTools: [],
      tokenEvents: prependRefreshEvent(req, req.tokenEvents || []),
    })) return;

    let availableTools = [];
    let toolsError = null;
    try {
      availableTools = await buildAdminToolSchemas();
    } catch (err) {
      console.error('[admin-agent/init] Failed to fetch PingOne tool schemas:', err.message);
      toolsError = err.message;
    }

    const allTokenEvents = prependRefreshEvent(req, req.tokenEvents || []);

    if (toolsError) {
      return res.status(502).json({
        error: 'pingone_tools_unavailable',
        message: toolsError,
        initialized: true,
        agentConfigured: false,
        agentReady: false,
        tokenEvents: allTokenEvents,
      });
    }

    return res.json({
      sessionId: req.session.id,
      initialized: true,
      agentReady: true,
      agentConfigured: true,
      availableTools,
      tokenEvents: allTokenEvents,
    });
  } catch (error) {
    console.error('[admin-agent/init] Unexpected error:', error.message);
    return res.status(500).json({
      error: error.code || 'agent_init_error',
      message: error.message,
      initialized: false,
      agentConfigured: false,
      agentReady: false,
    });
  }
});

// POST /message — Process an admin agent message.
router.post('/message', async (req, res) => {
  try {
    appEventService.logEvent('agent', 'info', 'Admin agent request received', { tag: 'agent/admin_route' });

    const { message, customer } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message must be a non-empty string' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }
    const safeCustomer =
      customer && typeof customer === 'object' && customer.id != null
        ? { id: String(customer.id), name: customer.name != null ? String(customer.name) : null }
        : null;

    const { userId, accessToken, tokenEvents } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }
    if (!await requirePingOneAdminGroup(req, res, {
      agentConfigured: true,
      toolsCalled: [],
      tokenEvents: tokenEvents || [],
    })) return;

    const langchainConfig = req.session?.langchain_config || {};
    const runId = crypto.randomUUID();
    const runStartedAt = new Date().toISOString();

    const response = await processAdminMessage({
      message,
      userId,
      sessionId: req.session.id,
      tokenEvents: tokenEvents || [],
      langchainConfig,
      req,
      customer: safeCustomer,
    });

    // Save conversation history for admin agent (vertical='admin')
    try {
      conversationStore.saveMessage(userId, 'admin', 'user', message, { runId });
      conversationStore.saveMessage(userId, 'admin', 'assistant', response.reply || '', {
        runId,
        success: response.success !== false,
      });
    } catch (convErr) {
      console.warn('[admin-agent/message] conversationStore.saveMessage failed:', convErr.message);
    }

    // Archive to the same durable per-user history the other agent-execution
    // routes write to (agentInvokeRoute.js, demoAgentNl.js) — the admin
    // vertical was the one execution path with no run history recorded anywhere.
    try {
      reportStore.saveRun({
        runId,
        userId,
        vertical: 'pingone-admin',
        prompt: message,
        startedAt: runStartedAt,
        completedAt: new Date().toISOString(),
        toolsCalled: response.toolsCalled || [],
        tokenEvents: response.tokenEvents || [],
        tokenCount: (response.tokenEvents || []).length,
        agentPath: 'admin-agent',
        success: response.success !== false,
        files: [],
      });
    } catch (reportErr) {
      console.warn('[admin-agent/message] reportStore.saveRun failed:', reportErr.message);
    }

    if (response.requiresConsent) {
      return res.status(428).json(response);
    }

    if (!response.success && response.error) {
      return res.status(502).json(response);
    }

    return res.json(response);
  } catch (error) {
    console.error('[admin-agent/message] Unexpected error:', error.message);
    return res.status(500).json({
      error: 'internal_error',
      message: error.message,
      success: false,
      toolsCalled: [],
      tokenEvents: [],
    });
  }
});

module.exports = router;
