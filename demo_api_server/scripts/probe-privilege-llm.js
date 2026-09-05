'use strict';
/**
 * Ad-hoc probe for the Privilege AI Gateway's LLM lanes
 * (https://<gateway>/llm/<provider>/v1/...). Prints the raw HTTP status and
 * JSON body instead of the app's error-mapped text (see
 * services/privilegeLlmProxyService.js), so we can see exactly what the
 * gateway/provider return and design the UI's error handling around real
 * shapes instead of guesses.
 *
 * Usage:
 *   node scripts/probe-privilege-llm.js [options]
 *
 * Options (all optional — defaults come from the same env vars the app uses,
 * loaded via loadDemoEnv so this also works from a worktree with no .env):
 *   --lane <anthropic|google|openai>   default: anthropic
 *   --base <url>                       default: $PRIVILEGE_LLM_GATEWAY_URL
 *   --key <virtual key>                default: $PRIVILEGE_LLM_VIRTUAL_KEY_<LANE>
 *   --model <name>                     default: the lane's own default model
 *   --route </llm/.../v1/...>          default: the lane's own route
 *   --shape <anthropic|openai>         default: matches --lane. The anthropic
 *                                      lane's default route is the native
 *                                      Messages API; pass --shape openai
 *                                      (with --route .../chat/completions) to
 *                                      test the OpenAI-compatible shape on
 *                                      the SAME lane instead.
 *   --message <text>                   default: "Hello"
 *
 * Example — reproduce "OpenAI SDK pointed at the anthropic lane, gpt-4o":
 *   node scripts/probe-privilege-llm.js --lane anthropic --shape openai \
 *     --route /llm/anthropic/v1/chat/completions --model gpt-4o
 */
require('./loadDemoEnv').loadDemoEnv();
const { llmFetch } = require('../services/llmFetch');
const { LANES, resolveRoute } = require('../services/privilegeLlmProxyService');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1];
  }
  return out;
}

function maskKey(key) {
  if (!key) return '(none)';
  return key.length <= 8 ? '***' : `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lane = args.lane || 'anthropic';
  if (!LANES[lane]) throw new Error(`Unknown --lane "${lane}" — expected one of ${Object.keys(LANES).join(', ')}`);

  const base = args.base || process.env.PRIVILEGE_LLM_GATEWAY_URL || '';
  if (!base) throw new Error('No gateway base URL — pass --base or set PRIVILEGE_LLM_GATEWAY_URL');
  const key = args.key || process.env[LANES[lane].keyEnv] || '';
  if (!key) throw new Error(`No virtual key — pass --key or set ${LANES[lane].keyEnv}`);
  const model = args.model || LANES[lane].defaultModel;
  const route = resolveRoute(lane, args.route);
  const shape = args.shape || lane; // anthropic lane defaults to the native shape
  const message = args.message || 'Hello';
  const url = `${base.replace(/\/+$/, '')}${route}`;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  let body;
  if (shape === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 512, messages: [{ role: 'user', content: message }] };
  } else {
    body = { model, max_tokens: 512, messages: [{ role: 'user', content: message }] };
  }

  console.log('--- request ---');
  console.log('URL    ', url);
  console.log('shape  ', shape);
  console.log('headers', { ...headers, Authorization: `Bearer ${maskKey(key)}` });
  console.log('body   ', JSON.stringify(body, null, 2));

  const res = await llmFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, {
    label: `probe-${lane}`,
    timeoutMs: 15000,
    retryOn429: false,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  console.log('\n--- response ---');
  console.log('status ', res.status, res.statusText);
  console.log('body   ', parsed ? JSON.stringify(parsed, null, 2) : text);
}

main().catch((err) => {
  console.error('\n--- probe failed ---');
  console.error(err.message);
  process.exit(1);
});
