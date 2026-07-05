const http = require('http');
const { verticalManifest } = require('./verticalManifest');

/**
 * Build an AG-UI CUSTOM event object.
 * @param {string} name - Event name (e.g., 'token_chain_bearer_obtained')
 * @param {object} value - Event payload
 * @returns {object} { type: 'CUSTOM', name, value }
 */
function buildCustomEvent(name, value) {
  return {
    type: 'CUSTOM',
    name,
    value,
  };
}

/**
 * Map token event IDs to AG-UI CUSTOM event names.
 * @param {string} tokenEventId - The token event id
 * @returns {string} AG-UI event name
 */
function mapTokenEventIdToEventName(tokenEventId) {
  if (tokenEventId === 'user-token') {
    return 'token_chain_bearer_obtained';
  }
  if (tokenEventId === 'exchange-in-progress') {
    return 'token_chain_exchange_started';
  }
  if (
    tokenEventId === 'exchanged-token' ||
    tokenEventId.startsWith('exchanged-token') ||
    tokenEventId.includes('exchanged')
  ) {
    return 'token_chain_mcp_token_obtained';
  }
  // Default: convert id to event name (replace hyphens with underscores)
  return `token_chain_${tokenEventId.replace(/-/g, '_')}`;
}

/**
 * Convert token events from agentMcpTokenService to AG-UI CUSTOM events.
 * @param {array} tokenEvents - Array of token event objects
 * @returns {array} Array of AG-UI CUSTOM event objects
 */
function buildTokenChainEvents(tokenEvents) {
  return tokenEvents.map((tokenEvent) => {
    const eventName = mapTokenEventIdToEventName(tokenEvent.id);
    const eventValue = {
      label: tokenEvent.label,
      status: tokenEvent.status,
      claims: tokenEvent.claims,
    };
    return buildCustomEvent(eventName, eventValue);
  });
}

/**
 * Write an SSE event to the response.
 * @param {object} res - Express response object
 * @param {object} eventObj - Event object with 'type', 'name', 'value' or 'data'
 */
function writeSseEvent(res, eventObj) {
  const jsonStr = JSON.stringify(eventObj);
  res.write(`data: ${jsonStr}\n\n`);
}

/**
 * Proxy agent SSE stream to browser, injecting token chain events first.
 * @param {object} options
 * @param {object} options.browserRes - Express response to browser
 * @param {string} options.runId - Run ID
 * @param {string} options.sessionId - Session ID
 * @param {string} options.message - User message
 * @param {string} options.authToken - Auth token
 * @param {array} options.tokenChainEvents - Token chain events to inject
 */
function proxyAgentSse(options) {
  const {
    browserRes,
    runId,
    sessionId,
    message,
    authToken,
    tokenChainEvents,
    vertical, // session-scoped vertical resolved by the route (falls back to global)
  } = options;

  const agentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';

  // Inject token chain events first
  if (tokenChainEvents && Array.isArray(tokenChainEvents)) {
    tokenChainEvents.forEach((event) => {
      writeSseEvent(browserRes, event);
    });
  }

  // Pass vertical persona to the LangChain agent so it adopts the correct
  // domain voice. Resolved BFF-side from the active vertical manifest;
  // never touches the browser.
  const manifest = verticalManifest.resolver.resolve(vertical || verticalManifest.resolver.activeId());
  const verticalFlavor = manifest?.agent?.systemPromptFlavor || null;

  // Build request body
  const requestBody = JSON.stringify({
    message,
    session_id: sessionId,
    auth_token: authToken,
    run_id: runId,
    vertical_flavor: verticalFlavor,
  });

  const requestOptions = {
    hostname: new URL(agentUrl).hostname,
    port: new URL(agentUrl).port || 80,
    path: '/run',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      'Accept': 'text/event-stream',
    },
  };

  // Bound the upstream agent call; a hung agent must not leave the browser SSE
  // stream open forever with no RUN_FINISHED.
  const AGENT_TIMEOUT_MS = Number(process.env.AGENT_SSE_TIMEOUT_MS) || 120000;

  // Emit an error terminus to the browser exactly once, from whichever failure
  // path fires first (connect error, mid-stream agent error, or timeout).
  let finished = false;
  const failStream = (err) => {
    if (finished) return;
    finished = true;
    console.error('[aguiSseProxy] Agent request error:', err.message);
    writeSseEvent(browserRes, { type: 'ERROR', error: err.message });
    writeSseEvent(browserRes, { type: 'RUN_FINISHED', status: 'error' });
    browserRes.end();
  };

  const req = http.request(requestOptions, (agentRes) => {
    // pipe() does NOT forward a mid-stream source error, so handle it explicitly
    // — otherwise an agent dying mid-reply hangs the browser stream.
    agentRes.on('error', failStream);
    agentRes.on('end', () => { finished = true; });
    agentRes.pipe(browserRes);
  });

  req.on('error', failStream);
  req.setTimeout(AGENT_TIMEOUT_MS, () => {
    req.destroy(new Error(`agent request timed out after ${AGENT_TIMEOUT_MS}ms`));
  });

  req.write(requestBody);
  req.end();
}

module.exports = {
  buildCustomEvent,
  buildTokenChainEvents,
  writeSseEvent,
  proxyAgentSse,
};
