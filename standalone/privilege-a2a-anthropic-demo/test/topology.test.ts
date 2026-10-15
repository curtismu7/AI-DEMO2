import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { test } from 'node:test';

interface AnthropicRequest {
  model: string;
  stream?: boolean;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string }>;
}

interface AnthropicCall {
  model: string;
  authorization: string | undefined;
  request: AnthropicRequest;
}

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxCli = join(packageDirectory, 'node_modules/tsx/dist/cli.mjs');

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function hasToolResult(messages: AnthropicRequest['messages']): boolean {
  return messages.some(message => Array.isArray(message.content)
    && message.content.some(block => Boolean(block && typeof block === 'object' && 'type' in block && block.type === 'tool_result')));
}

function lastUserText(messages: AnthropicRequest['messages']): string {
  const userMessage = [...messages].reverse().find(message => message.role === 'user');
  return typeof userMessage?.content === 'string' ? userMessage.content : '';
}

function delegatedPerson(request: AnthropicRequest): 'Carol Nguyen' | 'Erin Walsh' {
  return lastUserText(request.messages).includes('Erin Walsh') ? 'Erin Walsh' : 'Carol Nguyen';
}

function personFromToolResults(messages: AnthropicRequest['messages']): 'Carol Nguyen' | 'Erin Walsh' {
  const text = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => Boolean(block && typeof block === 'object' && 'type' in block && block.type === 'tool_result'))
    .map(block => String((block as { content?: unknown }).content ?? ''))
    .join('\n');
  return text.includes('Erin Walsh') ? 'Erin Walsh' : 'Carol Nguyen';
}

function responseFor(request: AnthropicRequest): {
  stopReason: 'tool_use' | 'end_turn';
  content: Array<Record<string, unknown>>;
} {
  if (request.model === 'test-main' && !hasToolResult(request.messages)) {
    const person = delegatedPerson(request);
    return {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: `main-delegate-${person}`, name: 'delegate_to_analyst', input: { question: `Review ${person}'s current entitlements.` } }],
    };
  }
  if (request.model === 'test-worker' && !hasToolResult(request.messages) && request.tools?.some(tool => tool.name === 'get_portfolio_summary')) {
    return {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: 'worker-banking', name: 'get_portfolio_summary', input: {} }],
    };
  }
  if (request.model === 'test-worker' && hasToolResult(request.messages) && JSON.stringify(request.messages).includes('worker-banking')) {
    return { stopReason: 'end_turn', content: [{ type: 'text', text: 'Investment positions reviewed.' }] };
  }
  if (request.model === 'test-worker' && !hasToolResult(request.messages)) {
    assert.deepEqual(request.tools?.map(tool => tool.name).sort(), ['get_access_grants', 'list_entitlements', 'open_ticket', 'who_has_role'], 'no-profile worker is offered exactly the four Acme tools');
    const person = delegatedPerson(request);
    return {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: `worker-lookup-${person}`, name: 'list_entitlements', input: { user: person } }],
    };
  }
  if (request.model === 'test-worker') {
    const person = personFromToolResults(request.messages);
    return {
      stopReason: 'end_turn',
      content: [{ type: 'text', text: `${person} has an access grant recorded by the test fixture.` }],
    };
  }
  const person = personFromToolResults(request.messages);
  return {
    stopReason: 'end_turn',
    content: [{ type: 'text', text: `${person} has an access grant recorded by the test fixture.` }],
  };
}

function anthropicJsonBody(model: string, answer: ReturnType<typeof responseFor>) {
  return {
    id: `msg_${model}`,
    type: 'message',
    role: 'assistant',
    model,
    content: answer.content,
    stop_reason: answer.stopReason,
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 12 },
  };
}

function sendAnthropicStream(res: Response, model: string, answer: ReturnType<typeof responseFor>): void {
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const message = {
    id: `msg_${model}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 0 },
  };
  const frames: Array<{ type: string; [key: string]: unknown }> = [
    { type: 'message_start', message },
  ];
  for (const [index, block] of answer.content.entries()) {
    if (block.type === 'tool_use') {
      frames.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      frames.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    } else {
      frames.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      frames.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    }
    frames.push({ type: 'content_block_stop', index });
  }
  frames.push({
    type: 'message_delta',
    delta: { stop_reason: answer.stopReason, stop_sequence: null },
    usage: { output_tokens: 12 },
  });
  frames.push({ type: 'message_stop' });
  for (const frame of frames) res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
  res.end();
}

async function startMockAnthropic(calls: AnthropicCall[]): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/v1/messages', async (req: Request, res: Response) => {
    const request = req.body as AnthropicRequest;
    calls.push({ model: request.model, authorization: req.header('authorization'), request });
    const answer = responseFor(request);
    if (request.model === 'test-worker' && !hasToolResult(request.messages)) await delay(150);
    if (request.stream) sendAnthropicStream(res, request.model, answer);
    else res.json(anthropicJsonBody(request.model, answer));
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

interface RunningProcess {
  name: string;
  process: ChildProcess;
  output: string;
}

function startProcess(name: string, source: string, env: NodeJS.ProcessEnv): RunningProcess {
  const child = spawn(process.execPath, [tsxCli, source], {
    cwd: packageDirectory,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const running: RunningProcess = { name, process: child, output: '' };
  child.stdout?.on('data', chunk => { running.output += String(chunk); });
  child.stderr?.on('data', chunk => { running.output += String(chunk); });
  child.on('error', error => assert.fail(`${name} process failed to start: ${error.message}`));
  return running;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => undefined);
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function waitUntilReady(
  checks: Array<{ name: string; url: string }>,
  children: RunningProcess[],
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastStatuses = '';
  while (Date.now() < deadline) {
    const exited = children.find(({ process }) => process.exitCode !== null || process.signalCode !== null);
    if (exited) assert.fail(`${exited.name} exited before becoming ready (code ${exited.process.exitCode}):\n${exited.output}`);
    const results = await Promise.all(checks.map(async ({ name, url }) => {
      try {
        const response = await fetch(url);
        const body = await response.text();
        return { name, ok: response.ok, detail: `${response.status} ${body.slice(0, 200)}` };
      } catch (error) {
        return { name, ok: false, detail: String(error) };
      }
    }));
    lastStatuses = results.map(result => `${result.name}: ${result.detail}`).join('\n');
    if (results.every(result => result.ok)) return;
    await delay(100);
  }
  assert.fail(`Timed out waiting for ${checks.map(check => check.name).join(', ')}. Last responses:\n${lastStatuses}\nChild output:\n${children.map(child => `${child.name}:\n${child.output}`).join('\n')}`);
}

function sseEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return [...body.matchAll(/event: ([^\n]+)\ndata: ([^\n]+)\n/g)].flatMap((match) => {
    try { return [{ event: match[1]!, data: JSON.parse(match[2]!) as Record<string, unknown> }]; }
    catch { return []; }
  });
}

test('main delegates through authenticated A2A, worker calls authenticated MCP, and both use their own Anthropic keys', async () => {
  const calls: AnthropicCall[] = [];
  const mockAnthropic = await startMockAnthropic(calls);
  const mockPort = (mockAnthropic.address() as AddressInfo).port;
  const mainPort = await reservePort();
  const workerPort = await reservePort();
  const mcpPort = await reservePort();
  const workerKey = 'test-worker-agent-access-key';
  const mainKey = 'test-main-agent-access-key';

  const processes = [
    startProcess('MCP', 'src/mcp-server/index.ts', {
      MCP_SERVER_PORT: String(mcpPort),
      MCP_REQUIRE_BEARER: 'true',
      MCP_STATEFUL: 'false',
      MCP_JSON_RESPONSE: 'true',
    }),
    startProcess('worker', 'src/worker-agent/index.ts', {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`,
      WORKER_AGENT_PROVIDER: 'anthropic',
      WORKER_AGENT_KEY: workerKey,
      WORKER_AGENT_MODEL: 'test-worker',
      WORKER_AGENT_PORT: String(workerPort),
      MCP_SERVER_PORT: String(mcpPort),
      MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
      WORKER_REQUIRE_BEARER: 'true',
    }),
    startProcess('main', 'src/main-agent/index.ts', {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`,
      MAIN_AGENT_PROVIDER: 'anthropic',
      MAIN_AGENT_KEY: mainKey,
      MAIN_AGENT_MODEL: 'test-main',
      MAIN_AGENT_HOST: '127.0.0.1',
      MAIN_AGENT_PORT: String(mainPort),
      WORKER_AGENT_PORT: String(workerPort),
      WORKER_A2A_URL: `http://127.0.0.1:${workerPort}/a2a`,
      WORKER_TRACE_URL: `http://127.0.0.1:${workerPort}/trace`,
      A2A_BFF_SHARED_SECRET: 'test-bff-shared-secret',
    }),
  ];

  try {
    await waitUntilReady([
      { name: 'MCP', url: `http://127.0.0.1:${mcpPort}/healthz` },
      { name: 'worker A2A', url: `http://127.0.0.1:${workerPort}/a2a/.well-known/agent-card.json` },
      { name: 'main', url: `http://127.0.0.1:${mainPort}/status` },
    ], processes);

    const cardResponse = await fetch(`http://127.0.0.1:${workerPort}/a2a/.well-known/agent-card.json`);
    assert.equal(cardResponse.status, 200);
    const workerCard = await cardResponse.json() as { url?: string; preferredTransport?: string };
    assert.equal(workerCard.url, `http://127.0.0.1:${workerPort}/a2a/jsonrpc`);
    assert.equal(workerCard.preferredTransport, 'JSONRPC');

    const unauthorized = await fetch(`http://127.0.0.1:${mainPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: "Review Carol Nguyen's current entitlements." }),
    });
    assert.equal(unauthorized.status, 401, 'integration chat must require the BFF shared secret');

    const chat = async (person: 'Carol Nguyen' | 'Erin Walsh') => {
      const response = await fetch(`http://127.0.0.1:${mainPort}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-BFF-Secret': 'test-bff-shared-secret',
        },
        body: JSON.stringify({ message: `Review ${person}'s current entitlements.`, sessionId: `session-${person}` }),
      });
      assert.equal(response.status, 200);
      return sseEvents(await response.text());
    };

    const [carolEvents, erinEvents] = await Promise.all([chat('Carol Nguyen'), chat('Erin Walsh')]);
    for (const [person, events] of [['Carol Nguyen', carolEvents], ['Erin Walsh', erinEvents]] as const) {
      const answer = events.filter(event => event.event === 'token').map(event => event.data.text).join('');
      assert.equal(answer, `${person} has an access grant recorded by the test fixture.`);
      assert.ok(events.some(event => event.event === 'done'), `${person} chat should complete successfully`);
      assert.ok(events.some(event => event.event === 'trace' && event.data.kind === 'delegate'), `${person} main agent should report A2A delegation`);
      const traces = events.filter(event => event.event === 'trace').map(event => event.data);
      const delegate = traces.find(data => data.kind === 'delegate');
      const result = traces.find(data => data.kind === 'result');
      assert.equal(delegate?.from, 'main');
      assert.equal(delegate?.to, 'analyst');
      for (const trace of traces) {
        assert.ok(!('fromLabel' in trace) && !('toLabel' in trace), `${person} no-profile run must carry no label fields`);
      }
      assert.match(String(delegate?.request), /message\/send/, `${person} delegate should carry the A2A request`);
      assert.equal(typeof result?.elapsedMs, 'number', `${person} result should carry elapsedMs`);
      assert.match(String(result?.response), /^HTTP 200/, `${person} result should carry the A2A response`);
      const mcpCall = traces.find(data => data.kind === 'mcp-call');
      if (mcpCall) assert.deepEqual([mcpCall.from, mcpCall.to], ['analyst', 'mcp']);
    }

    const carolTrace = carolEvents.filter(event => event.event === 'trace').map(event => JSON.stringify(event.data)).join('\n');
    const erinTrace = erinEvents.filter(event => event.event === 'trace').map(event => JSON.stringify(event.data)).join('\n');
    assert.match(carolTrace, /Carol Nguyen/, 'Carol chat should receive its own worker trace');
    assert.doesNotMatch(carolTrace, /Erin Walsh/, 'Carol chat must not receive Erin access-review details');
    assert.match(erinTrace, /Erin Walsh/, 'Erin chat should receive its own worker trace');
    assert.doesNotMatch(erinTrace, /Carol Nguyen/, 'Erin chat must not receive Carol access-review details');

    const mainCalls = calls.filter(call => call.model === 'test-main');
    const workerCalls = calls.filter(call => call.model === 'test-worker');
    assert.equal(mainCalls.length, 2, 'main should call Anthropic once per chat to delegate, then return the analyst answer directly');
    assert.equal(workerCalls.length, 4, 'worker should call Anthropic for tool selection and analysis for each chat');
    assert.ok(mainCalls.every(call => call.authorization === `Bearer ${mainKey}`), 'main Anthropic calls should use the main agent key');
    assert.ok(workerCalls.every(call => call.authorization === `Bearer ${workerKey}`), 'worker Anthropic calls should use the worker agent key');

    const workerToolResults = workerCalls.flatMap(call => call.request.messages
      .flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(block => Boolean(block && typeof block === 'object' && 'type' in block && block.type === 'tool_result'))
      .map(block => String((block as { content?: unknown }).content ?? '')));
    assert.equal(workerToolResults.length, 2, 'both worker chats should send their MCP result back to Anthropic');
    assert.ok(workerToolResults.some(result => result.includes('Carol Nguyen')));
    assert.ok(workerToolResults.some(result => result.includes('Erin Walsh')));
    assert.ok(workerToolResults.every(result => result.includes('entitlements')));
    const noProfileSystem = String((mainCalls[0]!.request as { system?: string }).system);
    assert.match(noProfileSystem, /access-review concierge/, 'no profile keeps today\'s concierge prompt');

    // A banking profile: labels, only the banking tools offered, banking fixture data from the MCP.
    const callsBefore = calls.length;
    const bankingTools = ['get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions'];
    const bankingResponse = await fetch(`http://127.0.0.1:${mainPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-A2A-BFF-Secret': 'test-bff-shared-secret' },
      body: JSON.stringify({
        message: 'Review my investment positions.',
        sessionId: 'session-banking',
        vertical: 'banking',
        agentName: 'Super Banking agent',
        specialistName: 'Investment Advisor',
        tool: 'get_portfolio_summary',
        tools: bankingTools,
        subtaskHint: 'review the customer’s investment positions',
      }),
    });
    assert.equal(bankingResponse.status, 200);
    const bankingEvents = sseEvents(await bankingResponse.text());
    const bankingTraces = bankingEvents.filter(event => event.event === 'trace').map(event => event.data);
    assert.ok(bankingEvents.some(event => event.event === 'done'));
    const first = (kind: string) => bankingTraces.find(data => data.kind === kind);
    for (const kind of ['delegate', 'result', 'mcp-call', 'mcp-result']) assert.ok(first(kind), `banking run should emit ${kind}`);
    const labels = (kind: string) => [first(kind)?.fromLabel, first(kind)?.toLabel];
    assert.deepEqual(labels('delegate'), ['Super Banking agent', 'Investment Advisor']);
    assert.deepEqual(labels('result'), ['Investment Advisor', 'Super Banking agent']);
    assert.deepEqual(labels('mcp-call'), ['Investment Advisor', 'Investment Advisor data tools']);
    assert.deepEqual(labels('mcp-result'), ['Investment Advisor data tools', 'Investment Advisor']);
    assert.deepEqual([first('delegate')?.from, first('delegate')?.to], ['main', 'analyst'], 'role keys stay unchanged');
    assert.match(JSON.stringify(first('mcp-result')), /totalValue/, 'MCP returned banking fixture data');
    const bankingCalls = calls.slice(callsBefore);
    const mainBanking = bankingCalls.find(call => call.model === 'test-main')!;
    assert.match(String((mainBanking.request as { system?: string }).system), /Super Banking agent/);
    assert.deepEqual(mainBanking.request.tools?.map(tool => tool.name), ['delegate_to_analyst']);
    const workerBanking = bankingCalls.find(call => call.model === 'test-worker')!;
    assert.deepEqual(workerBanking.request.tools?.map(tool => tool.name).sort(), [...bankingTools].sort(), 'worker is offered only the banking tools');
    assert.match(String((workerBanking.request as { system?: string }).system), /Investment Advisor/);

    // Same profile with mode 'heuristics': zero model calls, same trace hops, same MCP data.
    const beforeHeuristic = calls.length;
    const heuristicResponse = await fetch(`http://127.0.0.1:${mainPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-A2A-BFF-Secret': 'test-bff-shared-secret' },
      body: JSON.stringify({
        message: 'Show my investment accounts.',
        sessionId: 'session-heuristic',
        mode: 'heuristics',
        vertical: 'banking',
        agentName: 'Super Banking agent',
        specialistName: 'Investment Advisor',
        tool: 'get_portfolio_summary',
        tools: bankingTools,
        subtaskHint: 'review the customer’s investment positions',
      }),
    });
    assert.equal(heuristicResponse.status, 200);
    const heuristicEvents = sseEvents(await heuristicResponse.text());
    assert.equal(calls.length, beforeHeuristic, 'heuristics mode must not call any model');
    assert.ok(heuristicEvents.some(event => event.event === 'done'));
    const heuristicTraces = heuristicEvents.filter(event => event.event === 'trace').map(event => event.data);
    for (const kind of ['delegate', 'result', 'mcp-call', 'mcp-result']) assert.ok(heuristicTraces.some(t => t.kind === kind), `heuristic run should emit ${kind}`);
    assert.match(JSON.stringify(heuristicTraces.find(t => t.kind === 'mcp-call')), /get_investment_accounts/, 'keyword pick chose the accounts tool');
    assert.match(JSON.stringify(heuristicEvents), /INV-1001/, 'the MCP fixture reached the answer');
    assert.ok(!heuristicTraces.some(t => t.kind === 'worker-done'), 'the worker end-of-trace marker is never shown to the user');

    // Regression: retail data carries ISO dates and status words, which the scope-claim filter drops unless the
    // worker reports the raw tool output. The run used to delegate four times and then call a model.
    const beforeRetail = calls.length;
    const retailResponse = await fetch(`http://127.0.0.1:${mainPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-A2A-BFF-Secret': 'test-bff-shared-secret' },
      body: JSON.stringify({
        message: 'Review my recent order history.',
        sessionId: 'session-retail-heuristic',
        mode: 'heuristics',
        vertical: 'retail',
        agentName: 'Great Buy agent',
        specialistName: 'Purchase History Specialist',
        tool: 'sensitive_order_history',
        tools: ['sensitive_order_history'],
        subtaskHint: 'review the sensitive order / purchase history',
      }),
    });
    const retailEvents = sseEvents(await retailResponse.text());
    const retailTraces = retailEvents.filter(event => event.event === 'trace').map(event => event.data);
    assert.equal(calls.length, beforeRetail, 'a dated answer must not trigger a model call in heuristics mode');
    assert.equal(retailTraces.filter(t => t.kind === 'delegate').length, 1, 'heuristics delegates exactly once');
    assert.ok(!retailTraces.some(t => t.kind === 'model'), 'no model hop in a model-free run');
    assert.match(JSON.stringify(retailEvents), /ORD-9982/, 'the dated order record reaches the answer');
  } finally {
    await Promise.all(processes.map(child => stopProcess(child.process)));
    await new Promise<void>((resolve, reject) => mockAnthropic.close(error => error ? reject(error) : resolve()));
  }
});
