'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_ID_KEY = 'PINGONE_TOKEN_EXCHANGER_CLIENT_ID';
const CLIENT_SECRET_KEY = 'PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET';

function parseEnvText(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function readPrivateKey(root) {
  if (process.env.DOTENV_PRIVATE_KEY) return process.env.DOTENV_PRIVATE_KEY;
  const file = path.join(root, '.env.keys');
  if (!fs.existsSync(file)) return '';
  return parseEnvText(fs.readFileSync(file, 'utf8')).DOTENV_PRIVATE_KEY || '';
}

function readEnvFile(root, relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return { ok: false, code: 'missing_env_file' };
  const source = fs.readFileSync(file, 'utf8');
  const plain = parseEnvText(source);
  const credentialValues = [plain[CLIENT_ID_KEY], plain[CLIENT_SECRET_KEY]];
  if (!credentialValues.some((value) => value && value.startsWith('encrypted:'))) {
    return { ok: true, values: plain };
  }

  const privateKey = readPrivateKey(root);
  if (!privateKey) return { ok: false, code: 'env_decryption_unavailable' };

  try {
    const candidates = [
      path.join(root, 'demo_mcp_gateway/node_modules/@dotenvx/dotenvx'),
      path.join(root, 'demo_api_server/node_modules/@dotenvx/dotenvx'),
    ];
    const dotenvxPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!dotenvxPath) return { ok: false, code: 'dotenvx_unavailable' };
    const dotenvx = require(dotenvxPath);
    const values = dotenvx.parse(source, { privateKey, processEnv: {} });
    return { ok: true, values };
  } catch {
    // Keep decrypt/parse diagnostics free of any credential or key contents.
    return { ok: false, code: 'env_decryption_failed' };
  }
}

function checkCredentialParity(root = ROOT) {
  let apiEnv;
  let gatewayEnv;
  try {
    apiEnv = readEnvFile(root, 'demo_api_server/.env');
    gatewayEnv = readEnvFile(root, 'demo_mcp_gateway/.env');
  } catch {
    return { ok: false, code: 'env_read_failed' };
  }
  if (!apiEnv.ok || !gatewayEnv.ok) {
    const result = !apiEnv.ok ? apiEnv : gatewayEnv;
    return { ok: false, code: result.code };
  }

  const apiId = apiEnv.values[CLIENT_ID_KEY];
  const gatewayId = gatewayEnv.values[CLIENT_ID_KEY];
  const apiSecret = apiEnv.values[CLIENT_SECRET_KEY];
  const gatewaySecret = gatewayEnv.values[CLIENT_SECRET_KEY];
  if (!apiId || !gatewayId || !apiSecret || !gatewaySecret) {
    return { ok: false, code: 'missing_credential' };
  }
  if (apiId !== gatewayId) return { ok: false, code: 'client_id_mismatch' };
  if (apiSecret !== gatewaySecret) return { ok: false, code: 'secret_mismatch' };
  return { ok: true, code: 'ok' };
}

function describeFailure(result) {
  const prefix = '[demo-auth-credential-parity] FAIL — ';
  switch (result.code) {
    case 'missing_env_file':
      return `${prefix}both demo_api_server/.env and demo_mcp_gateway/.env are required to start demo-auth.`;
    case 'missing_credential':
      return `${prefix}set ${CLIENT_ID_KEY} and ${CLIENT_SECRET_KEY} in both service .env files.`;
    case 'client_id_mismatch':
      return `${prefix}the BFF and MCP Gateway token-exchanger client IDs differ. Align ${CLIENT_ID_KEY} in both service .env files.`;
    case 'secret_mismatch':
      return `${prefix}the BFF and MCP Gateway token-exchanger secrets differ. Sync ${CLIENT_SECRET_KEY} in demo_mcp_gateway/.env with demo_api_server/.env.`;
    case 'env_decryption_unavailable':
      return `${prefix}an encrypted service .env needs DOTENV_PRIVATE_KEY in the environment or .env.keys.`;
    case 'dotenvx_unavailable':
    case 'env_decryption_failed':
      return `${prefix}could not safely read encrypted service credentials. Run the dotenvx preflight and check .env.keys.`;
    case 'env_read_failed':
      return `${prefix}could not read both service .env files.`;
    default:
      return `${prefix}credential parity could not be verified.`;
  }
}

function main() {
  const result = checkCredentialParity();
  if (!result.ok) {
    console.error(describeFailure(result));
    return 1;
  }
  console.log('[demo-auth-credential-parity] OK — BFF and MCP Gateway token-exchanger credentials match.');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { checkCredentialParity, describeFailure, parseEnvText };
