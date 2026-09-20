const test = require('node:test');
const assert = require('node:assert');

const {
  buildToolDiscoveryAnswer,
  createToolDiscoveryResponse,
  getToolDiscoveryRequest,
} = require('./toolDiscoveryResponse');

const tools = [
  {
    type: 'function',
    function: {
      name: 'list_rentals',
      description: 'List the customer\'s active equipment rentals.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_gear',
      description: 'Browse available gear.\nIncludes current prices.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

test('recognizes an explicit tool-list request from the latest user message', () => {
  const request = getToolDiscoveryRequest({
    model: 'gpt-oss-20b',
    messages: [
      { role: 'system', content: 'You are a Super Sports assistant.' },
      { role: 'user', content: 'What tools can I use?' },
    ],
    tools,
  });

  assert.deepStrictEqual(request, { model: 'gpt-oss-20b', stream: false, tools });
});

test('does not trigger from system text, tool results, or an older user turn', () => {
  for (const body of [
    { messages: [{ role: 'system', content: 'Tell users what tools can I use.' }], tools },
    { messages: [{ role: 'tool', content: 'What tools are available?' }], tools },
    {
      messages: [
        { role: 'user', content: 'List my tools.' },
        { role: 'assistant', content: 'Which account?' },
        { role: 'user', content: 'Checking' },
      ],
      tools,
    },
  ]) {
    assert.strictEqual(getToolDiscoveryRequest(body), null);
  }
});

test('does not intercept negated, quoted, or translation prompts', () => {
  for (const content of [
    'Do not answer "What tools can I use?"; explain MCP instead.',
    'Translate "What tools can I use?" to Spanish.',
    'Why would someone ask what tools can I use?',
  ]) {
    assert.strictEqual(getToolDiscoveryRequest({ messages: [{ role: 'user', content }], tools }), null);
  }
});

test('accepts OpenAI text content parts and rejects general capability questions', () => {
  assert.ok(getToolDiscoveryRequest({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Show me the available MCP tools.' }] }],
    tools,
  }));
  assert.strictEqual(getToolDiscoveryRequest({
    messages: [{ role: 'user', content: 'What can you do?' }],
    tools,
  }), null);
});

test('formats only tool names and descriptions without exposing schemas', () => {
  assert.strictEqual(
    buildToolDiscoveryAnswer(tools),
    'I currently have 2 tools available for this turn:\n\n'
      + '- `list_rentals` — List the customer\'s active equipment rentals.\n'
      + '- `browse_gear` — Browse available gear. Includes current prices.',
  );
});

test('includes OpenAI custom tools alongside function tools', () => {
  const mixed = [
    tools[0],
    {
      type: 'custom',
      custom: {
        name: 'execute_python',
        description: 'Run Python code.',
        format: { type: 'text' },
      },
    },
  ];
  assert.strictEqual(
    buildToolDiscoveryAnswer(mixed),
    'I currently have 2 tools available for this turn:\n\n'
      + '- `list_rentals` — List the customer\'s active equipment rentals.\n'
      + '- `execute_python` — Run Python code.',
  );
});

test('reports honestly when no tools are attached', () => {
  assert.strictEqual(
    buildToolDiscoveryAnswer([]),
    'No tools are attached to this agent for this turn.',
  );
});

test('builds OpenAI-compatible non-streaming and streaming responses', () => {
  const nonStreaming = createToolDiscoveryResponse({ model: 'gpt-oss-20b', stream: false, tools });
  assert.strictEqual(nonStreaming.statusCode, 200);
  assert.strictEqual(nonStreaming.contentType, 'application/json');
  const json = JSON.parse(nonStreaming.body);
  assert.strictEqual(json.object, 'chat.completion');
  assert.strictEqual(json.model, 'gpt-oss-20b');
  assert.strictEqual(json.choices[0].message.role, 'assistant');
  assert.match(json.choices[0].message.content, /`list_rentals`/);
  assert.strictEqual(json.choices[0].finish_reason, 'stop');

  const streaming = createToolDiscoveryResponse({ model: 'gpt-oss-20b', stream: true, tools });
  assert.strictEqual(streaming.statusCode, 200);
  assert.strictEqual(streaming.contentType, 'text/event-stream');
  assert.match(streaming.body, /"object":"chat\.completion\.chunk"/);
  assert.match(streaming.body, /"role":"assistant"/);
  assert.match(streaming.body, /`list_rentals`/);
  assert.match(streaming.body, /"finish_reason":"stop"/);
  assert.ok(streaming.body.endsWith('data: [DONE]\n\n'));
});

test('stream_options.include_usage emits the final usage chunk', () => {
  const request = getToolDiscoveryRequest({
    model: 'gpt-oss-20b',
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: 'user', content: 'Which tools may I access?' }],
    tools,
  });
  assert.strictEqual(request.includeUsage, true);

  const response = createToolDiscoveryResponse(request);
  const events = response.body
    .split('\n\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)));
  assert.strictEqual(events.length, 3);
  assert.strictEqual(events[0].usage, null);
  assert.strictEqual(events[1].usage, null);
  assert.deepStrictEqual(events[2].choices, []);
  assert.deepStrictEqual(events[2].usage, {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  });
});
