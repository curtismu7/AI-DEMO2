import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

const HOST = '127.0.0.1';
const PORT = 33418;
const STATIC_DIR = path.resolve('public');

const state = {
  config: {
    mcpUrl: 'https://mcpgwtarun.ping-devops.com/mcp',
    clientId: '',
    scopes: 'openid profile email',
    llmUrl: 'http://127.0.0.1:11434',
    llmModel: 'llama3.2:1b'
  },
  oauth: {
    accessToken: null,
    refreshToken: null,
    expiresAt: null
  },
  tools: [],
  mcpSession: {
    initialized: false,
    protocolVersion: null,
    sessionId: null
  },
  pendingAuth: null,
  eventClients: new Set()
};

function nowIso() {
  return new Date().toISOString();
}

function emitEvent(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ts: nowIso(), ...payload })}\n\n`;
  for (const client of state.eventClients) {
    client.write(msg);
  }
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function getMime(fileName) {
  if (fileName.endsWith('.html')) return 'text/html; charset=utf-8';
  if (fileName.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (fileName.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function sanitizeFilePath(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, '');
  return path.join(STATIC_DIR, resolved);
}

function randomString(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

async function fetchMcp(pathname, body, withAuth = true) {
  if (!state.config.mcpUrl) {
    throw new Error('MCP URL is required');
  }
  const targetUrl = new URL(state.config.mcpUrl);
  targetUrl.pathname = pathname || targetUrl.pathname;
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth && state.oauth.accessToken) {
    headers.Authorization = `Bearer ${state.oauth.accessToken}`;
  }
  if (state.mcpSession.sessionId) {
    headers['MCP-Session-Id'] = state.mcpSession.sessionId;
  }

  emitEvent('relay', {
    direction: 'client->mcp',
    method: 'POST',
    url: targetUrl.toString(),
    body
  });

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const parsed = decodeMcpBody(text);

  const responseSessionId =
    response.headers.get('mcp-session-id') || response.headers.get('MCP-Session-Id');
  if (responseSessionId && responseSessionId !== state.mcpSession.sessionId) {
    state.mcpSession.sessionId = responseSessionId;
    emitEvent('mcp', {
      phase: 'session_attached',
      sessionId: responseSessionId
    });
  }

  emitEvent('relay', {
    direction: 'mcp->client',
    status: response.status,
    headers: {
      'www-authenticate': response.headers.get('www-authenticate'),
      'mcp-session-id': responseSessionId
    },
    body: parsed
  });

  if (!response.ok) {
    const normalized = normalizeMcpFailure(response, text);
    throw new Error(normalized);
  }

  if (parsed?.error) {
    throw new Error(`MCP RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }

  return parsed;
}

function decodeMcpBody(text) {
  if (!text || !text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // Keep parsing below.
  }

  // Handle event-stream style response payloads:
  // event: message
  // data: {"jsonrpc":"2.0",...}
  const lines = text.split('\n').map((line) => line.trim());
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (let i = dataLines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(dataLines[i]);
    } catch {
      // Continue searching.
    }
  }

  return { raw: text };
}

function resetMcpRuntimeState() {
  state.tools = [];
  state.mcpSession.initialized = false;
  state.mcpSession.protocolVersion = null;
  state.mcpSession.sessionId = null;
}

function normalizeMcpFailure(response, text) {
  const snippet = text.slice(0, 300);
  if (response.status === 502) {
    const lower = text.toLowerCase();
    if (lower.includes('<html') || lower.includes('bad gateway') || lower.includes('nginx')) {
      return (
        'MCP gateway returned 502 Bad Gateway from upstream. ' +
        'This usually means your authenticated user is not authorized for the target MCP tools ' +
        'or the upstream MCP service is unavailable.'
      );
    }
  }
  return `MCP request failed: ${response.status} ${snippet}`;
}

function parseLlmRouterJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('LLM returned empty response');
  }

  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with extraction.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // Continue with extraction.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through to final error.
    }
  }

  throw new Error('LLM response did not contain valid JSON payload');
}

async function ensureMcpSessionInitialized() {
  if (state.mcpSession.initialized) {
    return;
  }

  const initializeRpc = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'MCP Privilege Demo Client',
        version: '1.0.0'
      }
    }
  };

  const initResponse = await fetchMcp(null, initializeRpc, true);
  const serverProtocol = initResponse?.result?.protocolVersion || '2025-11-25';

  await fetchMcp(
    null,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    },
    true
  );

  state.mcpSession.initialized = true;
  state.mcpSession.protocolVersion = serverProtocol;
  emitEvent('mcp', {
    phase: 'initialized',
    protocolVersion: serverProtocol
  });
}

async function discoverAuth() {
  const response = await fetch(state.config.mcpUrl, { method: 'GET' });
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  const authHeader = response.headers.get('www-authenticate') || '';
  const authUriMatch = authHeader.match(/authorization_uri="([^"]+)"/);

  const authorizationUri = body.authorization_uri || (authUriMatch ? authUriMatch[1] : null);
  const tokenUri = body.token_uri || null;

  if (authorizationUri && tokenUri) {
    return { authorizationUri, tokenUri };
  }

  // PingOne hosted remote MCP currently responds with plain 401 JSON
  // (no authorization_uri/token_uri), so infer endpoints from env OIDC metadata.
  try {
    const mcpUrl = new URL(state.config.mcpUrl);
    const envMatch = mcpUrl.pathname.match(/\/v1\/environments\/([0-9a-fA-F-]{36})\/mcp\/?$/);
    const envId = envMatch?.[1];
    const authHost = mcpUrl.host.startsWith('api.') ? mcpUrl.host.replace(/^api\./, 'auth.') : 'auth.pingone.com';
    if (envId) {
      const wellKnownUrl = `https://${authHost}/${envId}/as/.well-known/openid-configuration`;
      const metaResponse = await fetch(wellKnownUrl, { method: 'GET' });
      if (metaResponse.ok) {
        const meta = await metaResponse.json();
        if (meta.authorization_endpoint && meta.token_endpoint) {
          return {
            authorizationUri: meta.authorization_endpoint,
            tokenUri: meta.token_endpoint
          };
        }
      }
    }
  } catch {
    // Keep primary discovery error below.
  }

  throw new Error(
    `Failed to discover OAuth metadata from MCP URL. status=${response.status}, body=${bodyText.slice(0, 200)}`
  );
}

async function handleStartAuth(req, res) {
  try {
    if (!state.config.clientId) {
      json(res, 400, { error: 'Client ID is required before auth start.' });
      return;
    }
    const { authorizationUri, tokenUri } = await discoverAuth();
    const verifier = randomString(48);
    const challenge = sha256Base64Url(verifier);
    const oauthState = randomString(24);
    const redirectUri = `http://${HOST}:${PORT}/auth/callback`;
    const authUrl = new URL(authorizationUri);
    authUrl.searchParams.set('client_id', state.config.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('scope', state.config.scopes);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', oauthState);

    state.pendingAuth = {
      oauthState,
      verifier,
      tokenUri,
      redirectUri
    };

    emitEvent('oauth', {
      phase: 'start',
      authorizationUri,
      tokenUri,
      authUrl: authUrl.toString()
    });

    json(res, 200, { authUrl: authUrl.toString() });
  } catch (error) {
    emitEvent('error', { scope: 'oauth_start', message: error.message });
    json(res, 500, { error: error.message });
  }
}

async function handleAuthCallback(req, res, parsedUrl) {
  const redirectWithError = (reason) => {
    const safeReason = encodeURIComponent((reason || 'OAuth callback failed').slice(0, 300));
    res.writeHead(302, { Location: `/?auth=error&reason=${safeReason}` });
    res.end();
  };

  try {
    const code = parsedUrl.searchParams.get('code');
    const incomingState = parsedUrl.searchParams.get('state');
    const error = parsedUrl.searchParams.get('error');
    const errorDescription = parsedUrl.searchParams.get('error_description');

    if (error) {
      const reason = errorDescription ? `${error}: ${errorDescription}` : error;
      emitEvent('oauth', { phase: 'callback_error', error: reason });
      redirectWithError(reason);
      return;
    }

    if (!state.pendingAuth || incomingState !== state.pendingAuth.oauthState) {
      throw new Error('OAuth state mismatch.');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: state.pendingAuth.redirectUri,
      client_id: state.config.clientId,
      code_verifier: state.pendingAuth.verifier
    });

    const tokenResponse = await fetch(state.pendingAuth.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const tokenText = await tokenResponse.text();
    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      throw new Error(`Token exchange returned non-JSON response: ${tokenText.slice(0, 300)}`);
    }
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenText.slice(0, 300)}`);
    }

    state.oauth.accessToken = tokenData.access_token;
    state.oauth.refreshToken = tokenData.refresh_token || null;
    state.oauth.expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : null;
    state.pendingAuth = null;
    state.tools = [];
    state.mcpSession.initialized = false;
    state.mcpSession.protocolVersion = null;
    state.mcpSession.sessionId = null;

    emitEvent('oauth', {
      phase: 'token_success',
      expiresIn: tokenData.expires_in || null
    });

    res.writeHead(302, { Location: '/?auth=success' });
    res.end();
  } catch (error) {
    emitEvent('error', { scope: 'oauth_callback', message: error.message });
    redirectWithError(error.message);
  }
}

async function handleListTools(req, res) {
  try {
    await ensureMcpSessionInitialized();
    const rpc = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {}
    };
    let data;
    try {
      data = await fetchMcp(null, rpc, true);
    } catch (error) {
      if (error.message.includes('invalid during session initialization')) {
        state.mcpSession.initialized = false;
        await ensureMcpSessionInitialized();
        data = await fetchMcp(null, rpc, true);
      } else {
        throw error;
      }
    }
    state.tools = data.result?.tools || [];
    json(res, 200, { tools: state.tools });
  } catch (error) {
    resetMcpRuntimeState();
    emitEvent('error', { scope: 'tools_list', message: error.message });
    json(res, 500, { error: error.message });
  }
}

async function handleCallTool(req, res) {
  try {
    await ensureMcpSessionInitialized();
    const body = await parseBody(req);
    const rpc = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: body.name,
        arguments: body.arguments || {}
      }
    };
    const data = await fetchMcp(null, rpc, true);
    json(res, 200, data);
  } catch (error) {
    emitEvent('error', { scope: 'tools_call', message: error.message });
    json(res, 500, { error: error.message });
  }
}

async function handleRawRpc(req, res) {
  try {
    const body = await parseBody(req);
    const method = body?.method || '';
    if (method && method !== 'initialize' && method !== 'notifications/initialized') {
      await ensureMcpSessionInitialized();
    }
    const data = await fetchMcp(null, body, true);
    json(res, 200, data);
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('502')) {
      resetMcpRuntimeState();
    }
    emitEvent('error', { scope: 'raw_rpc', message: error.message });
    json(res, 500, { error: error.message });
  }
}

async function handleLlmChat(req, res) {
  try {
    const body = await parseBody(req);
    if (!state.config.llmUrl || !state.config.llmModel) {
      json(res, 400, { error: 'LLM URL and model are required.' });
      return;
    }

    const parsed = await callLocalLlm([
      {
        role: 'system',
        content:
          'You are assisting an MCP operator. Use provided tools metadata to suggest exact tool calls when possible.'
      },
      {
        role: 'user',
        content: `${body.message}\n\nAvailable tools:\n${JSON.stringify(state.tools, null, 2)}`
      }
    ]);
    json(res, 200, {
      response: parsed.message?.content || parsed.response || ''
    });
  } catch (error) {
    emitEvent('error', { scope: 'llm_chat', message: error.message });
    json(res, 500, { error: error.message });
  }
}

async function callLocalLlm(messages) {
  if (!state.config.llmUrl || !state.config.llmModel) {
    throw new Error('LLM URL and model are required.');
  }

  const response = await fetch(`${state.config.llmUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: state.config.llmModel,
      stream: false,
      messages
    })
  });
  const text = await response.text();
  const parsed = JSON.parse(text);
  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return parsed;
}

async function handleDemoChat(req, res) {
  try {
    const body = await parseBody(req);
    const prompt = body.prompt || '';
    const steps = [];

    if (!state.config.mcpUrl) {
      json(res, 400, { error: 'Set MCP URL first.', steps });
      return;
    }

    if (!state.config.clientId) {
      json(res, 200, {
        reply:
          'I can connect, but OAuth Client ID is missing. Set Client ID and click Start OAuth to continue.',
        steps: [...steps, 'missing_client_id']
      });
      return;
    }

    if (!state.oauth.accessToken) {
      const { authorizationUri, tokenUri } = await discoverAuth();
      const verifier = randomString(48);
      const challenge = sha256Base64Url(verifier);
      const oauthState = randomString(24);
      const redirectUri = `http://${HOST}:${PORT}/auth/callback`;
      const authUrl = new URL(authorizationUri);
      authUrl.searchParams.set('client_id', state.config.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', state.config.scopes);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', oauthState);

      state.pendingAuth = { oauthState, verifier, tokenUri, redirectUri };
      json(res, 200, {
        reply: 'Please complete OAuth login first. I prepared the auth URL.',
        authUrl: authUrl.toString(),
        steps: [...steps, 'oauth_required']
      });
      return;
    }

    await ensureMcpSessionInitialized();
    steps.push('mcp_initialized');

    const toolsResponse = await fetchMcp(
      null,
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list',
        params: {}
      },
      true
    );
    state.tools = toolsResponse.result?.tools || [];
    steps.push(`tools_discovered:${state.tools.length}`);

    let reply = `Connected. I found ${state.tools.length} tools.`;
    let suggestions = [];
    try {
      const llm = await callLocalLlm([
        {
          role: 'system',
          content:
            'You are an MCP tool router for demos. Given a user prompt and available tools, return JSON only with shape: {"reply":"...","suggested_tools":[{"name":"tool_name","why":"...","arguments":{}}]}. Use only tool names from the list.'
        },
        {
          role: 'user',
          content: `User prompt:\n${prompt}\n\nAvailable tools:\n${JSON.stringify(
            state.tools.map((t) => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema || {}
            })),
            null,
            2
          )}`
        }
      ]);
      const raw = llm.message?.content || llm.response || '';
      const parsed = parseLlmRouterJson(raw);
      reply = parsed.reply || reply;
      suggestions = Array.isArray(parsed.suggested_tools) ? parsed.suggested_tools : [];
      steps.push('llm_routed');
    } catch (llmError) {
      suggestions = state.tools.map((tool) => ({
        name: tool.name,
        why: 'Fallback: showing discovered tools because LLM router output was not valid JSON.',
        arguments: {}
      }));
      steps.push(`llm_fallback:${llmError.message}`);
    }

    json(res, 200, {
      reply,
      tools: state.tools.map((t) => ({ name: t.name, description: t.description || '' })),
      suggested_tools: suggestions,
      steps
    });
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('502')) {
      resetMcpRuntimeState();
    }
    emitEvent('error', { scope: 'demo_chat', message: error.message });
    json(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && parsedUrl.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache'
    });
    res.write('\n');
    state.eventClients.add(res);
    req.on('close', () => state.eventClients.delete(res));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/state') {
    json(res, 200, {
      config: state.config,
      oauth: {
        authenticated: Boolean(state.oauth.accessToken),
        expiresAt: state.oauth.expiresAt
      },
      tools: state.tools
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/config') {
    try {
      const body = await parseBody(req);
      state.config = {
        ...state.config,
        ...body
      };
      state.tools = [];
      state.mcpSession.initialized = false;
      state.mcpSession.protocolVersion = null;
      state.mcpSession.sessionId = null;
      emitEvent('config', { config: state.config });
      json(res, 200, { ok: true, config: state.config });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/auth/start') {
    await handleStartAuth(req, res);
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/auth/callback') {
    await handleAuthCallback(req, res, parsedUrl);
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tools/list') {
    await handleListTools(req, res);
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tools/call') {
    await handleCallTool(req, res);
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/mcp/rpc') {
    await handleRawRpc(req, res);
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/llm/chat') {
    await handleLlmChat(req, res);
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/demo/chat') {
    await handleDemoChat(req, res);
    return;
  }

  if (req.method === 'GET') {
    const filePath = sanitizeFilePath(parsedUrl.pathname);
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': getMime(filePath) });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`MCP Demo Client running on http://${HOST}:${PORT}`);
  console.log('Open this URL in your browser and configure your MCP gateway.');
});
