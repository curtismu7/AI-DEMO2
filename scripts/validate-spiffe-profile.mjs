#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = [
  'spiffe/docker-compose/spire-server.conf',
  'spiffe/docker-compose/spire-agent.conf',
  'spiffe/docker-compose/helper-bff.conf',
  'spiffe/docker-compose/oidc-discovery-provider.conf',
  'spiffe/docker-compose/entries.sh',
  'spiffe/docker-compose/Dockerfile.registration',
  'spiffe/docker-compose/Dockerfile.agent',
];

const failures = [];
for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) failures.push(`missing ${relative}`);
}

const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
for (const service of ['spire-server:', 'spire-agent:', 'spire-registration:', 'spiffe-helper-bff:', 'spiffe-oidc-provider:']) {
  if (!compose.includes(service)) failures.push(`compose is missing ${service}`);
}
if (!/profiles:\s*\["spiffe"\]/.test(compose)) failures.push('SPIFFE services are not profile-gated');
if (!/spire-registration:[\s\S]*?dockerfile:\s*Dockerfile\.registration/.test(compose)) {
  failures.push('spire-registration must use the shell-enabled registration image');
}
if (!/spire-agent:[\s\S]*?dockerfile:\s*Dockerfile\.agent/.test(compose)) {
  failures.push('spire-agent must use the shell-enabled agent image');
}
const agentService = compose.match(/^  spire-agent:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:[ \t]*$)/m)?.[1] || '';
if (!/^    pid: host$/m.test(agentService)) {
  failures.push('SPIRE Docker workload attestation requires the agent to share the host PID namespace');
}
if (!compose.includes('FF_SPIFFE_CLIENT_AUTH')) failures.push('BFF SPIFFE client-auth flag is not wired');
const helperService = compose.match(/^  spiffe-helper-bff:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:[ \t]*$)/m)?.[1] || '';
if (!helperService.includes('com.ai-demo.spiffe-workload: bff')) {
  failures.push('SPIFFE helper must carry the BFF Docker workload selector');
}

const entries = fs.readFileSync(path.join(root, 'spiffe/docker-compose/entries.sh'), 'utf8');
const agentConfig = fs.readFileSync(path.join(root, 'spiffe/docker-compose/spire-agent.conf'), 'utf8');
const helperConfig = fs.readFileSync(path.join(root, 'spiffe/docker-compose/helper-bff.conf'), 'utf8');
const oidcConfig = fs.readFileSync(path.join(root, 'spiffe/docker-compose/oidc-discovery-provider.conf'), 'utf8');
for (const id of ['spiffe://bxfinance.demo/bff', 'spiffe://bxfinance.demo/agent', 'spiffe://bxfinance.demo/mcp-gateway', 'spiffe://bxfinance.demo/mcp-server']) {
  if (!entries.includes(id)) failures.push(`registration entry is missing ${id}`);
}
if (!entries.includes('-x509SVIDTTL 3600') || entries.includes('-ttl 3600')) {
  failures.push('registration entries must use the current X509 SVID TTL flag');
}
if (!entries.includes('spire-server entry update')) failures.push('registration job must update stable entries on rerun');
const updateStart = entries.indexOf('spire-server entry update');
const updateEnd = entries.indexOf('\n  else', updateStart);
const updateCommand = updateStart >= 0 && updateEnd >= 0
  ? entries.slice(updateStart, updateEnd)
  : '';
if (!updateCommand.includes('-spiffeID "$SPIFFE_ID"')) {
  failures.push('registration job must preserve the SPIFFE ID when updating stable entries');
}
if (!entries.includes('code = NotFound') || !entries.includes('entry not found')) {
  failures.push('registration job must create workload entries only for SPIRE NotFound errors');
}
if (!entries.includes('NODE_SPIFFE_ID_PREFIX="spiffe://bxfinance.demo/spire/agent/join_token"')
  || !entries.includes('NODE_SPIFFE_ID="$NODE_SPIFFE_ID_PREFIX/$TOKEN"')) {
  failures.push('registration job must derive the agent parent ID from the join token');
}
if (!entries.includes('-jwtSVIDTTL 3600')) {
  failures.push('registration entries must configure a JWT SVID TTL');
}
for (const selector of [
  'docker:label:com.ai-demo.spiffe-workload:bff',
  'docker:label:com.ai-demo.spiffe-workload:agent',
  'docker:label:com.ai-demo.spiffe-workload:mcp-gateway',
  'docker:label:com.ai-demo.spiffe-workload:mcp-server',
]) {
  if (!entries.includes(selector)) failures.push(`registration job is missing Docker label selector ${selector}`);
}
if (/docker:label:com\.ai-demo\.spiffe-workload=/.test(entries)) {
  failures.push('Docker workload label selectors must use key:value syntax');
}
if (!entries.includes('Missing or mismatched registration entry')) failures.push('registration job must verify entry parent and selector');
if (!/KeyManager\s+"disk"\s*\{\s*plugin_data\s*\{\s*directory\s*=/.test(agentConfig)) {
  failures.push('SPIRE agent disk key manager must configure its directory');
}
if (!agentConfig.includes('docker_socket_path = "unix:///var/run/docker.sock"')) {
  failures.push('SPIRE agent Docker attestor must use a unix socket address');
}
for (const setting of [
  'agent_address = "/run/spire-agent/sockets/agent.sock"',
  'cert_dir = "/run/spiffe"',
  'svid_file_name = "svid.pem"',
  'svid_key_file_name = "svid.key"',
  'svid_bundle_file_name = "bundle.pem"',
  'jwt_svids = [{ jwt_audience = "bxfinance.demo", jwt_svid_file_name = "svid.jwt" }]',
  'daemon_mode = true',
]) {
  if (!helperConfig.includes(setting)) failures.push(`SPIFFE helper config is missing ${setting}`);
}
for (const setting of [
  'allow_insecure_scheme = true',
  'insecure_addr = "0.0.0.0:8443"',
  'domains = ["spiffe-oidc-provider"]',
]) {
  if (!oidcConfig.includes(setting)) failures.push(`OIDC discovery provider config is missing ${setting}`);
}
if (!/server_api\s*\{\s*address\s*=\s*"unix:\/\/\/run\/spire\/server\/private\/api\.sock"/.test(oidcConfig)) {
  failures.push('OIDC discovery provider config must use the SPIRE Server API socket');
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`✓ SPIFFE profile validated (${requiredFiles.length} config files, 5 compose services, 4 workload entries)`);
}
