import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { anthropicClient, describeMode, mainAgentConfig, providerOf, viaGateway, workerAgentConfig } from '../src/config.js';

const KEYS = [
  'MAIN_AGENT_PROVIDER', 'WORKER_AGENT_PROVIDER', 'MAIN_AGENT_MODEL', 'WORKER_AGENT_MODEL',
  'ANTHROPIC_BASE_URL', 'GEMINI_BASE_URL', 'GROQ_BASE_URL', 'GROQ_API_KEY', 'MAIN_AGENT_GROQ_KEY', 'WORKER_AGENT_GROQ_KEY',
  'MAIN_AGENT_KEY', 'WORKER_AGENT_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'MAIN_AGENT_GEMINI_KEY', 'GROQ_TIMEOUT_MS',
  'ANTHROPIC_AUTH_TOKEN', 'LLAMACPP_BASE_URL', 'LLAMACPP_API_KEY', 'MAIN_AGENT_LLAMACPP_KEY', 'WORKER_AGENT_LLAMACPP_KEY', 'LLAMACPP_MODEL',
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('each agent picks its own provider; anything unknown, or nothing, is llama.cpp', () => {
  assert.equal(providerOf('MAIN_AGENT'), 'llamacpp');
  process.env.MAIN_AGENT_PROVIDER = 'Groq';
  process.env.WORKER_AGENT_PROVIDER = 'google';
  assert.equal(providerOf('MAIN_AGENT'), 'groq');
  assert.equal(providerOf('WORKER_AGENT'), 'google');
  process.env.MAIN_AGENT_PROVIDER = 'openai';
  assert.equal(providerOf('MAIN_AGENT'), 'llamacpp');
  process.env.MAIN_AGENT_PROVIDER = 'anthropic';
  assert.equal(providerOf('MAIN_AGENT'), 'anthropic');
});

test('each provider has its own default model, and the _MODEL setting wins', () => {
  // The config builds the real client, so each provider needs some key (a dummy; nothing is called).
  process.env.ANTHROPIC_API_KEY = 'a';
  process.env.GEMINI_API_KEY = 'g';
  process.env.LLAMACPP_API_KEY = 'l';
  // Default provider is llama.cpp with the gateway custom-lane model.
  assert.equal(mainAgentConfig().model, 'llama.cpp');
  process.env.MAIN_AGENT_PROVIDER = 'google';
  assert.equal(mainAgentConfig().model, 'gemini-flash-latest');
  process.env.MAIN_AGENT_PROVIDER = 'anthropic';
  assert.equal(mainAgentConfig().model, 'claude-sonnet-5');
  process.env.MAIN_AGENT_PROVIDER = 'groq';
  process.env.WORKER_AGENT_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'g';
  assert.equal(mainAgentConfig().model, 'openai/gpt-oss-120b');
  assert.equal(workerAgentConfig().model, 'openai/gpt-oss-120b');
  process.env.MAIN_AGENT_MODEL = 'llama-3.1-8b-instant';
  assert.equal(mainAgentConfig().model, 'llama-3.1-8b-instant');
});

test('Groq is never "via Privilege", even if gateway URLs are set, and says plainly that it bypasses it', () => {
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example/llm/anthropic';
  process.env.GEMINI_BASE_URL = 'https://gateway.example/llm/google';
  process.env.MAIN_AGENT_PROVIDER = 'groq';
  assert.equal(viaGateway('MAIN_AGENT'), false);
  assert.match(describeMode('MAIN_AGENT'), /Groq.*bypass the Privilege gateway/);
  // The other providers still read as via Privilege when their base URL is set.
  process.env.WORKER_AGENT_PROVIDER = 'google';
  assert.equal(viaGateway('WORKER_AGENT'), true);
  assert.match(describeMode('WORKER_AGENT'), /^Google via Privilege/);
});

test('Groq needs a key and says where to put it; a per-agent key or the shared key both work', () => {
  process.env.MAIN_AGENT_PROVIDER = 'groq';
  assert.throws(() => anthropicClient('MAIN_AGENT'), /MAIN_AGENT_GROQ_KEY or GROQ_API_KEY/);
  process.env.GROQ_API_KEY = 'shared';
  assert.ok(anthropicClient('MAIN_AGENT'));
  delete process.env.GROQ_API_KEY;
  process.env.MAIN_AGENT_GROQ_KEY = 'own';
  assert.ok(anthropicClient('MAIN_AGENT'));
});

test('the Groq error text is never mistaken for an Anthropic or Google one in the status line', () => {
  process.env.MAIN_AGENT_PROVIDER = 'groq';
  assert.doesNotMatch(describeMode('MAIN_AGENT'), /Anthropic|Google/);
});

// ── llama.cpp provider ────────────────────────────────────────────────────────
// The default lane: llama.cpp THROUGH the Privilege gateway's custom route
// (/llm/custom/v1 — OpenAI chat-completions wire, custom virtual key as the
// Bearer). Unlike Groq, it stays inside the gateway's records and policy.

test('llama.cpp is the DEFAULT provider for both agents, with the gateway model', () => {
  // No provider env at all → llamacpp, model = the gateway custom lane's model.
  process.env.LLAMACPP_API_KEY = 'k';
  const cfg = mainAgentConfig();
  assert.equal(providerOf('MAIN_AGENT'), 'llamacpp');
  assert.equal(cfg.model, 'llama.cpp');
  assert.equal(providerOf('WORKER_AGENT'), 'llamacpp');
  assert.equal(workerAgentConfig().model, 'llama.cpp');
  // An explicit _MODEL still wins.
  process.env.MAIN_AGENT_MODEL = 'llama-3.2-3b-instruct';
  assert.equal(mainAgentConfig().model, 'llama-3.2-3b-instruct');
});

test('llama.cpp runs via Privilege when the gateway base URL is set, and says so', () => {
  process.env.LLAMACPP_BASE_URL = 'https://gateway.example/llm/custom/v1';
  process.env.LLAMACPP_API_KEY = 'k';
  assert.equal(viaGateway('MAIN_AGENT'), true);
  assert.match(describeMode('MAIN_AGENT'), /llama\.cpp via Privilege/);
});

test('llama.cpp needs a key and says where to put it; per-agent or shared both work', () => {
  process.env.MAIN_AGENT_PROVIDER = 'llamacpp';
  process.env.LLAMACPP_BASE_URL = 'https://gateway.example/llm/custom/v1';
  assert.throws(() => anthropicClient('MAIN_AGENT'), /MAIN_AGENT_LLAMACPP_KEY or LLAMACPP_API_KEY/);
  process.env.LLAMACPP_API_KEY = 'shared';
  assert.ok(anthropicClient('MAIN_AGENT'));
  delete process.env.LLAMACPP_API_KEY;
  process.env.MAIN_AGENT_LLAMACPP_KEY = 'own';
  assert.ok(anthropicClient('MAIN_AGENT'));
});

test('llama.cpp without a base URL runs direct at llama-server and says so', () => {
  process.env.LLAMACPP_API_KEY = 'k';
  delete process.env.LLAMACPP_BASE_URL;
  assert.equal(viaGateway('MAIN_AGENT'), false);
  assert.match(describeMode('MAIN_AGENT'), /llama\.cpp direct/);
});

test('the Anthropic lane can take its own key, leaving the agent key as the A2A bearer', () => {
  // The gateway rejects an Agent Access key bound to another provider
  // ("key not valid for provider anthropic"), so the lane needs its own.
  process.env.MAIN_AGENT_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example/llm/anthropic';
  process.env.MAIN_AGENT_KEY = 'agent-key';
  assert.equal(anthropicClient('MAIN_AGENT').authToken, 'agent-key');
  process.env.ANTHROPIC_AUTH_TOKEN = 'lane-key';
  assert.equal(anthropicClient('MAIN_AGENT').authToken, 'lane-key');
  assert.equal(mainAgentConfig().bearer, 'agent-key');
});
