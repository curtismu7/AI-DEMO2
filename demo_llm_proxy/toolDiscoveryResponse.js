'use strict';

const crypto = require('crypto');

const TOOL_DISCOVERY_PATTERNS = [
  /^\s*(?:please\s+)?(?:what|which)\s+(?:mcp\s+)?tools?\s+(?:can|could|may)\s+i\s+(?:use|access)(?:\s+(?:right\s+now|currently))?\s*[?.!]*\s*$/i,
  /^\s*(?:please\s+)?(?:what|which)\s+(?:mcp\s+)?tools?\s+(?:are\s+available(?:\s+to\s+me)?|do\s+i\s+have(?:\s+access\s+to)?)\s*[?.!]*\s*$/i,
  /^\s*(?:please\s+)?what\s+(?:mcp\s+)?tools?\s+do\s+you\s+have\s*[?.!]*\s*$/i,
  /^\s*(?:please\s+)?(?:list|show)(?:\s+me)?\s+(?:the\s+|my\s+)?(?:available\s+)?(?:mcp\s+)?tools?(?:\s+available)?(?:\s+from\s+.+)?\s*[?.!]*\s*$/i,
];

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function getToolDiscoveryRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return null;
  const latest = body.messages[body.messages.length - 1];
  if (!latest || latest.role !== 'user') return null;
  const text = messageText(latest.content);
  if (!TOOL_DISCOVERY_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return {
    model: typeof body.model === 'string' && body.model ? body.model : 'demo-llm-proxy',
    stream: body.stream === true,
    tools: Array.isArray(body.tools) ? body.tools : [],
    ...(body.stream === true && body.stream_options?.include_usage === true
      ? { includeUsage: true }
      : {}),
  };
}

function normalizeTools(tools) {
  const seen = new Set();
  const normalized = [];
  for (const tool of tools || []) {
    const definition = tool?.type === 'function'
      ? tool.function
      : tool?.type === 'custom'
        ? tool.custom
        : tool;
    const name = typeof definition?.name === 'string' ? definition.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = typeof definition.description === 'string'
      ? definition.description.replace(/\s+/g, ' ').trim()
      : '';
    normalized.push({ name, description });
  }
  return normalized;
}

function buildToolDiscoveryAnswer(tools) {
  const available = normalizeTools(tools);
  if (available.length === 0) return 'No tools are attached to this agent for this turn.';
  const rows = available.map(({ name, description }) =>
    `- \`${name.replace(/`/g, '')}\`${description ? ` — ${description}` : ''}`,
  );
  return `I currently have ${available.length} tool${available.length === 1 ? '' : 's'} available for this turn:\n\n${rows.join('\n')}`;
}

function createToolDiscoveryResponse({ model, stream, tools, includeUsage = false }) {
  const id = `chatcmpl-tool-discovery-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const content = buildToolDiscoveryAnswer(tools);

  if (stream) {
    const base = { id, object: 'chat.completion.chunk', created, model };
    const chunks = [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    if (includeUsage) {
      for (const chunk of chunks) chunk.usage = null;
      chunks.push({
        ...base,
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
    return {
      statusCode: 200,
      contentType: 'text/event-stream',
      body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    };
  }

  return {
    statusCode: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
  };
}

module.exports = {
  buildToolDiscoveryAnswer,
  createToolDiscoveryResponse,
  getToolDiscoveryRequest,
};
