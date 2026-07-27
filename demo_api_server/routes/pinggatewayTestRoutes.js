'use strict';
/**
 * PingGateway Test Routes
 *
 * POST /api/admin/pinggateway/test/introspect
 * POST /api/admin/pinggateway/test/authorize
 * POST /api/admin/pinggateway/test/mcp-call
 *
 * Test endpoints for PingGateway token introspection, authorization, and MCP tool invocation.
 * Returns detailed response including step-by-step trace of what happened.
 */

const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Helper: make HTTP request to PingGateway
 */
function callPingGateway(method, path, body = null) {
  return new Promise((resolve, reject) => {
    // Same orphan as pingGatewayClient.js had (#972): PINGGATEWAY_URL is read
    // here but nothing sets it — compose sets MCP_PINGGATEWAY_URL. The fallback
    // is worse than wrong: inside the BFF container localhost is the BFF, and
    // 3036 is the HOST port (IG listens on 8080 in-network).
    const gwUrl = process.env.PINGGATEWAY_URL
      || process.env.MCP_PINGGATEWAY_URL
      || (() => { try { return require('../services/configStore').getEffective('mcp_pinggateway_url'); } catch (_) { return null; } })()
      || 'https://localhost:3036';
    const url = new URL(path, gwUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
      timeout: 10000,
      ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
    };

    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * POST /api/admin/pinggateway/test/introspect
 *
 * Test RFC 7662 token introspection through PingGateway
 * Request body: { token: "...", expectedClientId?: "...", expectedAud?: "..." }
 */
router.post('/test/introspect', async (req, res) => {
  const { token, expectedClientId, expectedAud } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token parameter required' });
  }

  const startTime = Date.now();
  const trace = [];

  try {
    trace.push({ step: 'calling_pinggateway_introspect', url: '/introspect', method: 'POST' });

    const gwResponse = await callPingGateway('POST', '/introspect', { token });
    const duration = Date.now() - startTime;

    trace.push({
      step: 'pinggateway_response',
      statusCode: gwResponse.statusCode,
      duration,
      body: gwResponse.body,
    });

    // Validate response
    const isActive = gwResponse.body?.active === true;
    const clientIdMatch = !expectedClientId || gwResponse.body?.client_id === expectedClientId;
    const audMatch = !expectedAud || gwResponse.body?.aud === expectedAud;

    trace.push({
      step: 'validation',
      active: isActive,
      clientIdMatch,
      audMatch,
      passed: isActive && clientIdMatch && audMatch,
    });

    res.json({
      success: isActive && clientIdMatch && audMatch,
      message: isActive ? 'Token is active' : 'Token is not active',
      trace,
      result: gwResponse.body,
    });

  } catch (err) {
    trace.push({
      step: 'error',
      error: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      success: false,
      error: err.message,
      trace,
    });
  }
});

/**
 * POST /api/admin/pinggateway/test/authorize
 *
 * Test PingOne Authorize decision through PingGateway
 * Request body: { token: "...", resourceId: "...", intentId?: "..." }
 */
router.post('/test/authorize', async (req, res) => {
  const { token, resourceId, intentId } = req.body;

  if (!token || !resourceId) {
    return res.status(400).json({ error: 'token and resourceId required' });
  }

  const startTime = Date.now();
  const trace = [];

  try {
    const payload = {
      token,
      resourceId,
      ...(intentId ? { intentId } : {}),
    };

    trace.push({ step: 'calling_pinggateway_authorize', url: '/authorize', method: 'POST', payload });

    const gwResponse = await callPingGateway('POST', '/authorize', payload);
    const duration = Date.now() - startTime;

    trace.push({
      step: 'pinggateway_response',
      statusCode: gwResponse.statusCode,
      duration,
      body: gwResponse.body,
    });

    res.json({
      success: gwResponse.statusCode >= 200 && gwResponse.statusCode < 300,
      trace,
      result: gwResponse.body,
    });

  } catch (err) {
    trace.push({
      step: 'error',
      error: err.message,
    });

    res.status(500).json({
      success: false,
      error: err.message,
      trace,
    });
  }
});

/**
 * POST /api/admin/pinggateway/test/mcp-call
 *
 * Test MCP tool invocation through PingGateway
 * Request body: { token: "...", toolName: "...", toolInput: {...} }
 */
router.post('/test/mcp-call', async (req, res) => {
  const { token, toolName, toolInput = {} } = req.body;

  if (!token || !toolName) {
    return res.status(400).json({ error: 'token and toolName required' });
  }

  const startTime = Date.now();
  const trace = [];

  try {
    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolInput,
      },
    };

    trace.push({
      step: 'calling_pinggateway_mcp',
      url: '/mcp',
      method: 'POST',
      tool: toolName,
      headers: { Authorization: `Bearer ${token.substring(0, 20)}...` },
    });

    const gwResponse = await callPingGateway('POST', '/mcp', payload);
    const duration = Date.now() - startTime;

    trace.push({
      step: 'pinggateway_response',
      statusCode: gwResponse.statusCode,
      duration,
      hasResult: !!gwResponse.body?.result,
      hasError: !!gwResponse.body?.error,
    });

    res.json({
      success: gwResponse.statusCode >= 200 && gwResponse.statusCode < 300 && !gwResponse.body?.error,
      trace,
      result: gwResponse.body,
    });

  } catch (err) {
    trace.push({
      step: 'error',
      error: err.message,
    });

    res.status(500).json({
      success: false,
      error: err.message,
      trace,
    });
  }
});

/**
 * GET /api/admin/pinggateway/test/config
 *
 * Return current PingGateway configuration for debugging
 */
router.get('/test/config', async (req, res) => {
  res.json({
    gwUrl: process.env.PINGGATEWAY_URL || 'https://localhost:3036',
    introspectionEndpoint: process.env.GW_INTROSPECTION_ENDPOINT || 'http://localhost:9001/as/introspect',
    introspectionClientId: process.env.GW_INTROSPECTION_CLIENT_ID ? '***set***' : 'not set',
    introspectionClientSecret: process.env.GW_INTROSPECTION_CLIENT_SECRET ? '***set***' : 'not set',
  });
});

module.exports = router;
