import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { anthropicClient, describeMode, mainAgentConfig, providerOf, viaGateway, workerAgentConfig } from '../src/config.js';

const KEYS = [
  'MAIN_AGENT_PROVIDER', 'WORKER_AGENT_PROVIDER', 'MAIN_AGENT_MODEL', 'WORKER_AGENT_MODEL',
  'ANTHROPIC_BASE_URL', 'GEMINI_BASE_URL', 'GROQ_BASE_URL', 'GROQ_API_KEY', 'MAIN_AGENT_GROQ_KEY', 'WORKER_AGENT_GROQ_KEY',
  'MAIN_AGENT_KEY', 'WORKER_AGENT_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'MAIN_AGENT_GEMINI_KEY', 'GROQ_TIMEOUT_MS',
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

test('each agent picks its own provider; anything unknown, or nothing, is Anthropic', () => {
  assert.equal(providerOf('MAIN_AGENT'), 'anthropic');
  process.env.MAIN_AGENT_PROVIDER = 'Groq';
  process.env.WORKER_AGENT_PROVIDER = 'google';
  assert.equal(providerOf('MAIN_AGENT'), 'groq');
  assert.equal(providerOf('WORKER_AGENT'), 'google');
  process.env.MAIN_AGENT_PROVIDER = 'openai';
  assert.equal(providerOf('MAIN_AGENT'), 'anthropic');
});

test('each provider has its own default model, and the _MODEL setting wins', () => {
  // The config builds the real client, so each provider needs some key (a dummy; nothing is called).
  process.env.ANTHROPIC_API_KEY = 'a';
  process.env.GEMINI_API_KEY = 'g';
  assert.equal(mainAgentConfig().model, 'claude-sonnet-5');
  process.env.MAIN_AGENT_PROVIDER = 'google';
  assert.equal(mainAgentConfig().model, 'gemini-flash-latest');
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
