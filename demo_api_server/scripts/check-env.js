/**
 * Startup environment variable validator.
 *
 * Prints a grouped configuration report at server start.
 * Output goes to the API log file (/tmp/bank-api-server.log by default,
 * overridden by LOG_FILE_PATH env var) and also to stdout so the terminal
 * shows it when running directly.
 *
 * REQUIRED vars: exits in production if any are missing.
 * FEATURE GROUPS: shows configured / partial / not configured per group.
 * Skipped entirely in test environments.
 *
 * Usage: require('./scripts/check-env') near top of server.js.
 */

const fs = require('fs');

const LOG_FILE = process.env.LOG_FILE_PATH || '/tmp/bank-api-server.log';

// ANSI codes — used in stdout output only; stripped for file output
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

// ── Required vars — missing = fatal in production ─────────────────────────────
const REQUIRED = [
  { name: 'PINGONE_ENVIRONMENT_ID',        desc: 'PingOne tenant environment UUID' },
  { name: 'PINGONE_ADMIN_CLIENT_ID',       desc: 'Admin OAuth app client ID' },
  { name: 'PINGONE_ADMIN_CLIENT_SECRET',   desc: 'Admin OAuth app client secret' },
  { name: 'PINGONE_USER_CLIENT_ID',        desc: 'User OAuth app client ID' },
  { name: 'PINGONE_USER_CLIENT_SECRET',    desc: 'User OAuth app client secret' },
  { name: 'SESSION_SECRET',                desc: 'Express session signing secret (min 32 chars)' },
  { name: 'PUBLIC_APP_URL',                desc: 'BFF public origin — drives OAuth redirect URIs' },
];

// ── Feature groups — printed as a status table ───────────────────────────────
const FEATURE_GROUPS = [
  {
    tag: 'MCP / AGENT',
    label: 'MCP Token Exchange',
    vars: [
      { name: 'MCP_SERVER_URL',                              desc: 'WebSocket URL of the MCP server' },
      { name: 'PINGONE_TOKEN_EXCHANGER_CLIENT_ID',         aliases: ['PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID', 'PINGONE_MCP_EXCHANGER_CLIENT_ID', 'AGENT_OAUTH_CLIENT_ID'],     desc: 'MCP token exchanger client ID' },
      { name: 'PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET',     aliases: ['PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET', 'PINGONE_MCP_EXCHANGER_CLIENT_SECRET', 'AGENT_OAUTH_CLIENT_SECRET'], desc: 'MCP token exchanger client secret' },
      { name: 'PINGONE_RESOURCE_MCP_SERVER_URI',           aliases: ['MCP_SERVER_RESOURCE_URI', 'MCP_RESOURCE_URI'],                    desc: 'MCP server resource URI (aud)' },
    ],
  },
  {
    tag: 'HELIX LLM',
    label: 'Helix AI Agent',
    vars: [
      { name: 'HELIX_BASE_URL',           desc: 'Helix tenant base URL' },
      { name: 'HELIX_API_KEY',            desc: 'Helix agent-scoped API key' },
      { name: 'HELIX_ENVIRONMENT_ID',     desc: 'Helix environment / tenant ID' },
      { name: 'HELIX_AGENT_ID',           desc: 'Published Helix agent name' },
      { name: 'HELIX_PROMPT_FIELD_ID',    desc: 'AI Task input field ID in the agent' },
    ],
  },
  {
    tag: 'AUTHORIZE',
    label: 'PingOne Authorize',
    vars: [
      { name: 'PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID',    desc: 'Authorize decision endpoint ID' },
      { name: 'PINGONE_AUTHORIZE_WORKER_CLIENT_ID',        desc: 'Authorize worker client ID' },
      { name: 'PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET',    desc: 'Authorize worker client secret' },
    ],
  },
  {
    tag: 'MGMT API',
    label: 'PingOne Worker / Management API',
    vars: [
      { name: 'PINGONE_WORKER_TOKEN_CLIENT_ID',      desc: 'Worker app client ID' },
      { name: 'PINGONE_WORKER_TOKEN_CLIENT_SECRET',  desc: 'Worker app client secret' },
    ],
  },
  {
    tag: 'CIBA',
    label: 'Backchannel Auth (CIBA)',
    vars: [
      { name: 'CIBA_ENABLED', desc: 'Set to true to enable CIBA flows' },
    ],
  },
  {
    tag: 'OLLAMA',
    label: 'Ollama (local LLM)',
    vars: [
      { name: 'OLLAMA_BASE_URL',    desc: 'Ollama server URL (default: http://127.0.0.1:11434)' },
      { name: 'OLLAMA_MODEL',       desc: 'Model name (default: qwen2.5:3b — run: ollama pull qwen2.5:3b)' },
      { name: 'OLLAMA_TIMEOUT_MS',  desc: 'Per-request timeout ms (default: 60000)' },
    ],
  },

];

// Strip ANSI escape codes for plain-text log file output
const ESC = '\x1b';
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

// Write one line to both stdout and the log file
function emit(ansiLine) {
  process.stdout.write(ansiLine + '\n');
  try {
    fs.appendFileSync(LOG_FILE, stripAnsi(ansiLine) + '\n');
  } catch (_) { /* best-effort */ }
}

function isSet(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '';
}

function varIsSet(v) {
  return isSet(v.name) || (v.aliases || []).some(a => isSet(a));
}

function groupStatus(vars) {
  const setCount = vars.filter(varIsSet).length;
  if (setCount === vars.length) return 'ok';
  if (setCount === 0) return 'off';
  return 'partial';
}

function checkEnv() {
  if (process.env.NODE_ENV === 'test') return { ok: true, missing: [] };

  const isProduction = process.env.NODE_ENV === 'production';
  const missing = REQUIRED.filter(v => !isSet(v.name));

  // ── Banner header ────────────────────────────────────────────────────────
  const line = '═'.repeat(66);
  emit('');
  emit(`${CYAN}${BOLD}╔${line}╗${RESET}`);
  emit(`${CYAN}${BOLD}║${RESET}${BOLD}           DEMO APP — STARTUP CONFIGURATION REPORT             ${RESET}${CYAN}${BOLD}║${RESET}`);
  emit(`${CYAN}${BOLD}╚${line}╝${RESET}`);
  emit('');

  // ── Required vars ────────────────────────────────────────────────────────
  if (missing.length > 0) {
    emit(`  ${RED}${BOLD}REQUIRED — missing (app will not work correctly):${RESET}`);
    missing.forEach(v => {
      emit(`    ${RED}✗${RESET}  ${BOLD}${v.name.padEnd(38)}${RESET}${DIM}${v.desc}${RESET}`);
    });
    emit('');
    if (isProduction) {
      emit(`  ${RED}${BOLD}FATAL: Required env vars missing in production — exiting.${RESET}`);
      emit('');
      process.exit(1);
    } else {
      emit(`  ${YELLOW}WARNING: Starting in development mode with missing required vars.${RESET}`);
      emit(`  ${YELLOW}Some features will not work. See docs/SETUP.md${RESET}`);
      emit('');
    }
  } else {
    const pub = process.env.PUBLIC_APP_URL;
    emit(`  ${GREEN}✓${RESET}  ${BOLD}Core OAuth / PingOne${RESET}${' '.repeat(18)}${GREEN}configured${RESET}`);
    emit(`      ${DIM}Admin redirect : ${pub}/api/auth/oauth/callback${RESET}`);
    emit(`      ${DIM}User  redirect : ${pub}/api/auth/oauth/user/callback${RESET}`);
  }

  // ── Feature group table ───────────────────────────────────────────────────
  emit('');
  FEATURE_GROUPS.forEach(group => {
    const status = groupStatus(group.vars);
    const tagPad = group.tag.padEnd(14);
    const labelPad = group.label.padEnd(34);

    if (status === 'ok') {
      emit(`  ${GREEN}✓${RESET}  ${DIM}[${tagPad}]${RESET}  ${labelPad}${GREEN}configured${RESET}`);
    } else if (status === 'partial') {
      const unset = group.vars.filter(v => !varIsSet(v)).map(v => v.name);
      emit(`  ${YELLOW}!${RESET}  ${DIM}[${tagPad}]${RESET}  ${labelPad}${YELLOW}partial${RESET}`);
      unset.forEach(name => {
        emit(`      ${YELLOW}missing:${RESET} ${name}`);
      });
    } else {
      emit(`  ${DIM}○  [${tagPad}]  ${labelPad}not configured${RESET}`);
    }
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  emit('');
  emit(`  ${DIM}Setup guide : docs/SETUP.md${RESET}`);
  emit(`  ${DIM}.env file   : banking_api_server/.env${RESET}`);
  emit('');

  return { ok: missing.length === 0, missing };
}

const result = checkEnv();
module.exports = result;
