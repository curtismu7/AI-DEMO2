'use strict';

const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const DEFAULT_TIMEOUT_MS = 5000;

function agentUrl() {
  return String(process.env.MCP_DISCOVERY_AGENT_URL || '').replace(/\/$/, '');
}

async function request(path, { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = agentUrl();
  if (!base) {
    const error = new Error('MCP discovery agent is not configured');
    error.httpStatus = 503;
    error.code = 'MCP_DISCOVERY_NOT_CONFIGURED';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`MCP discovery agent failed (${response.status})`);
      error.httpStatus = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.httpStatus) throw error;
    const normalized = normalizeAxiosError(Object.assign(error, { code: error.name === 'AbortError' ? 'ETIMEDOUT' : error.code }), {
      label: 'MCP discovery agent', timeoutMs,
    });
    normalized.httpStatus ||= 503;
    throw normalized;
  } finally {
    clearTimeout(timer);
  }
}

async function getInventory() {
  return request('/api/inventory');
}

async function requestScan() {
  return request('/api/scan', { method: 'POST' });
}

module.exports = { getInventory, requestScan, request };
