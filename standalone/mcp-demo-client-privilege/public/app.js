const els = {
  mcpUrl: document.querySelector('#mcpUrl'),
  clientId: document.querySelector('#clientId'),
  scopes: document.querySelector('#scopes'),
  llmUrl: document.querySelector('#llmUrl'),
  llmModel: document.querySelector('#llmModel'),
  saveConfigBtn: document.querySelector('#saveConfigBtn'),
  startAuthBtn: document.querySelector('#startAuthBtn'),
  listToolsBtn: document.querySelector('#listToolsBtn'),
  statusBox: document.querySelector('#statusBox'),
  connectionPill: document.querySelector('#connectionPill'),
  toolsSummary: document.querySelector('#toolsSummary'),
  toolSelect: document.querySelector('#toolSelect'),
  toolArgs: document.querySelector('#toolArgs'),
  callToolBtn: document.querySelector('#callToolBtn'),
  toolResult: document.querySelector('#toolResult'),
  rawRpcBox: document.querySelector('#rawRpcBox'),
  sendRawRpcBtn: document.querySelector('#sendRawRpcBtn'),
  rawRpcResult: document.querySelector('#rawRpcResult'),
  llmPrompt: document.querySelector('#llmPrompt'),
  askLlmBtn: document.querySelector('#askLlmBtn'),
  llmResult: document.querySelector('#llmResult'),
  eventLog: document.querySelector('#eventLog'),
  chatMessages: document.querySelector('#chatMessages'),
  chatPrompt: document.querySelector('#chatPrompt'),
  sendChatBtn: document.querySelector('#sendChatBtn'),
  chatThinking: document.querySelector('#chatThinking')
};

const uiState = {
  tools: [],
  authenticated: false,
  lastRefreshError: null,
  autoRefresh: {
    inFlight: false,
    timer: null,
    intervalMs: 5000,
    lastRun: null
  }
};

function setText(node, value) {
  node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function truncate(value, max = 240) {
  if (typeof value !== 'string') return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... (+${value.length - max} chars)`;
}

function summarizeEvent(entry) {
  const out = { ...entry };
  if (out.direction === 'mcp->client' && out.body?.result?.tools) {
    out.body = {
      summary: 'tools/list response',
      toolCount: out.body.result.tools.length,
      toolNames: out.body.result.tools.map((t) => t.name)
    };
  } else if (out.direction === 'mcp->client' && out.body?.raw) {
    out.body = { raw: truncate(out.body.raw, 280) };
  }
  if (out.message) out.message = truncate(out.message, 280);
  return out;
}

function appendEvent(entry) {
  const line = `[${entry.ts || new Date().toISOString()}] ${JSON.stringify(summarizeEvent(entry))}`;
  els.eventLog.textContent = `${line}\n${els.eventLog.textContent}`.slice(0, 50000);
}

function appendChat(role, content, extra = null) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;
  if (extra) {
    const meta = document.createElement('pre');
    meta.style.marginTop = '8px';
    meta.textContent = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
    bubble.appendChild(meta);
  }
  els.chatMessages.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function setThinking(active) {
  els.chatThinking.classList.toggle('hidden', !active);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error || text || `HTTP ${response.status}`);
  }
  return data;
}

function toolNames(tools) {
  return (tools || []).map((t) => t.name).sort();
}

function sameTools(a, b) {
  const aa = toolNames(a);
  const bb = toolNames(b);
  return aa.length === bb.length && aa.every((name, i) => name === bb[i]);
}

function renderTools(tools) {
  uiState.tools = tools || [];
  els.toolSelect.innerHTML = '';
  for (const tool of uiState.tools) {
    const option = document.createElement('option');
    option.value = tool.name;
    option.textContent = `${tool.name} — ${tool.description || 'No description'}`;
    els.toolSelect.appendChild(option);
  }
  setText(els.toolsSummary, {
    discoveredTools: uiState.tools.length,
    names: uiState.tools.map((t) => t.name)
  });
}

function renderStatus(extra = {}) {
  const payload = {
    authenticated: uiState.authenticated,
    discoveredTools: uiState.tools.length,
    lastAutoRefresh: uiState.autoRefresh.lastRun,
    ...extra
  };
  setText(els.statusBox, payload);
  els.connectionPill.textContent = uiState.authenticated ? 'Connected' : 'Not Authenticated';
  els.connectionPill.style.color = uiState.authenticated ? '#34d399' : '#fca5a5';
  els.connectionPill.style.borderColor = uiState.authenticated ? '#065f46' : '#7f1d1d';
}

async function refreshState() {
  const state = await api('/api/state');
  els.mcpUrl.value = state.config.mcpUrl || '';
  els.clientId.value = state.config.clientId || '';
  els.scopes.value = state.config.scopes || '';
  els.llmUrl.value = state.config.llmUrl || '';
  els.llmModel.value = state.config.llmModel || '';
  uiState.authenticated = Boolean(state.oauth?.authenticated);
  renderTools(state.tools || []);
  renderStatus({ tokenExpiresAt: state.oauth?.expiresAt || null });
}

async function saveConfigFromInputs() {
  const config = {
    mcpUrl: els.mcpUrl.value.trim(),
    clientId: els.clientId.value.trim(),
    scopes: els.scopes.value.trim(),
    llmUrl: els.llmUrl.value.trim(),
    llmModel: els.llmModel.value.trim()
  };
  await api('/api/config', { method: 'POST', body: config });
}

async function refreshToolsAuto() {
  if (uiState.autoRefresh.inFlight) return;
  uiState.autoRefresh.inFlight = true;
  try {
    const before = uiState.tools;
    const data = await api('/api/tools/list', { method: 'POST' });
    const nextTools = data.tools || [];
    uiState.authenticated = true;
    uiState.autoRefresh.lastRun = new Date().toISOString();
    if (!sameTools(before, nextTools)) {
      renderTools(nextTools);
      appendChat('system', `Tools updated (${nextTools.length}).`, {
        names: nextTools.map((t) => t.name)
      });
    } else {
      renderTools(nextTools);
    }
    if (uiState.lastRefreshError) {
      appendChat('system', 'Connection recovered.');
      uiState.lastRefreshError = null;
    }
    renderStatus({ mode: 'auto-refresh' });
  } catch (error) {
    const message = error.message;
    uiState.authenticated = false;
    uiState.autoRefresh.lastRun = new Date().toISOString();
    if (!uiState.lastRefreshError || uiState.lastRefreshError !== message) {
      appendChat('system', 'Auto-refresh failed.', { error: message });
      uiState.lastRefreshError = message;
    }
    renderTools([]);
    renderStatus({ mode: 'auto-refresh', warning: message });
  } finally {
    uiState.autoRefresh.inFlight = false;
  }
}

function scheduleAutoRefresh() {
  if (uiState.autoRefresh.timer) {
    clearTimeout(uiState.autoRefresh.timer);
  }
  uiState.autoRefresh.timer = setTimeout(async () => {
    await refreshToolsAuto();
    scheduleAutoRefresh();
  }, uiState.autoRefresh.intervalMs);
}

async function sendDemoChat() {
  const prompt = els.chatPrompt.value.trim();
  if (!prompt) return;

  appendChat('user', prompt);
  setThinking(true);
  try {
    await saveConfigFromInputs();
    const data = await api('/api/demo/chat', { method: 'POST', body: { prompt } });
    if (data.authUrl) {
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      appendChat('assistant', `${data.reply} (Opened OAuth in new tab)`, data.steps || null);
    } else {
      const availableTools = Array.isArray(data.tools) ? data.tools.map((t) => t.name) : [];
      appendChat('assistant', data.reply || 'Done.', {
        available_tools: availableTools,
        suggested_tools: data.suggested_tools || [],
        steps: data.steps || []
      });
      if (Array.isArray(data.tools)) {
        renderTools(data.tools);
        uiState.authenticated = true;
        renderStatus({ mode: 'chat-assisted' });
      }
    }
  } catch (error) {
    appendChat('assistant', `Error: ${error.message}`);
  } finally {
    setThinking(false);
  }
}

els.saveConfigBtn.addEventListener('click', async () => {
  try {
    await saveConfigFromInputs();
    await refreshState();
    appendChat('system', 'Config saved.');
  } catch (error) {
    appendEvent({ level: 'error', action: 'save_config', message: error.message });
  }
});

els.startAuthBtn.addEventListener('click', async () => {
  try {
    await saveConfigFromInputs();
    const data = await api('/api/auth/start', { method: 'POST' });
    window.open(data.authUrl, '_blank', 'noopener,noreferrer');
    appendChat('system', 'OAuth started. Complete login in the opened tab.');
  } catch (error) {
    appendChat('system', `OAuth start failed: ${error.message}`);
  }
});

els.listToolsBtn.addEventListener('click', async () => {
  await refreshToolsAuto();
});

els.sendChatBtn.addEventListener('click', async () => {
  await sendDemoChat();
});

els.chatPrompt.addEventListener('keydown', async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    await sendDemoChat();
  }
});

els.callToolBtn.addEventListener('click', async () => {
  try {
    const args = JSON.parse(els.toolArgs.value || '{}');
    const data = await api('/api/tools/call', {
      method: 'POST',
      body: { name: els.toolSelect.value, arguments: args }
    });
    setText(els.toolResult, data);
  } catch (error) {
    setText(els.toolResult, { error: error.message });
  }
});

els.sendRawRpcBtn.addEventListener('click', async () => {
  try {
    const rpc = JSON.parse(els.rawRpcBox.value);
    const data = await api('/api/mcp/rpc', { method: 'POST', body: rpc });
    setText(els.rawRpcResult, data);
  } catch (error) {
    setText(els.rawRpcResult, { error: error.message });
  }
});

els.askLlmBtn.addEventListener('click', async () => {
  try {
    await saveConfigFromInputs();
    const data = await api('/api/llm/chat', {
      method: 'POST',
      body: { message: els.llmPrompt.value }
    });
    setText(els.llmResult, data.response);
  } catch (error) {
    setText(els.llmResult, { error: error.message });
  }
});

const events = new EventSource('/api/events');
events.addEventListener('relay', (event) => appendEvent(JSON.parse(event.data)));
events.addEventListener('oauth', (event) => appendEvent(JSON.parse(event.data)));
events.addEventListener('config', (event) => appendEvent(JSON.parse(event.data)));
events.addEventListener('mcp', (event) => appendEvent(JSON.parse(event.data)));
events.addEventListener('error', (event) => appendEvent(JSON.parse(event.data)));

await refreshState();
await refreshToolsAuto();
scheduleAutoRefresh();
window.addEventListener('focus', () => {
  refreshToolsAuto();
});

const authResult = new URLSearchParams(window.location.search).get('auth');
const authErrorReason = new URLSearchParams(window.location.search).get('reason');
if (authResult === 'success') {
  appendChat('system', 'OAuth callback completed. Refreshing tools...');
  refreshToolsAuto();
}
if (authResult === 'error') {
  appendChat('system', 'OAuth callback failed.', {
    reason: authErrorReason ? decodeURIComponent(authErrorReason) : 'Unknown error'
  });
}
