#!/usr/bin/env node

/**
 * Read-only diagnosis for the Privilege Remote Agent login path.
 *
 * Usage:
 *   node scripts/probe-privilege-langchain-login.mjs
 *   node scripts/probe-privilege-langchain-login.mjs --skip-k8s
 *
 * Optional environment:
 *   PRIVILEGE_LANGCHAIN_FRONTEND  (default applications.procyon.ai URL)
 *   PRIVILEGE_LANGCHAIN_GATEWAY   (default mcpgw.ai-demo.ping-devops.com)
 *   PRIVILEGE_LANGCHAIN_NAMESPACE (default ping-devops-cmuir)
 *   KUBECTL_CONTEXT               (default current context)
 *
 * The probe never accepts or prints tokens, cookies, client secrets, or the
 * BFF_INTERNAL_SECRET. It performs GETs only and read-only kubectl queries.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_FRONTEND = 'https://langchainagent.default.applications.procyon.ai:8643';
const DEFAULT_GATEWAY = 'https://mcpgw.ai-demo.ping-devops.com';

export function parseHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter((block) => /^HTTP\//m.test(block));
  const block = blocks.at(-1) || '';
  const lines = block.split(/\r?\n/);
  const status = Number((/^HTTP\/\S+\s+(\d+)/.exec(lines[0] || '') || [])[1] || 0);
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  return { status, headers };
}

export function classify(results) {
  const failures = [];
  if (results.card !== 200) failures.push('Agent Card is not reachable through the Privilege frontend.');
  if (results.rpc !== 401) failures.push('Public JSON-RPC did not return the expected OAuth 401 challenge.');
  if (!results.authorizationUri) failures.push('OAuth challenge has no authorization_uri.');
  if (!results.resourceMetadata) failures.push('OAuth challenge has no resource_metadata URL.');
  if (results.metadata && results.metadata !== 200) failures.push('Protected-resource metadata is not reachable.');
  if (results.k8s === false) failures.push('The Kubernetes service has no ready endpoint.');
  return failures;
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function curl(url) {
  const result = run('curl', [
    '-ksS', '--connect-timeout', '8', '--max-time', '20',
    '-D', '-', '-o', '/dev/null', url,
  ]);
  if (result.error) return { status: 0, headers: {}, error: result.error.message };
  const parsed = parseHeaders(result.stdout);
  return { ...parsed, error: result.status === 0 ? '' : result.stderr.trim() };
}

function quotedChallengeValue(challenge, name) {
  const match = new RegExp(`${name}="([^"]+)"`, 'i').exec(challenge || '');
  return match?.[1] || '';
}

function checkK8s(namespace, context) {
  const prefix = context ? ['--context', context] : [];
  const service = run('kubectl', [
    ...prefix, 'get', 'service', 'langchain-agent', '-n', namespace,
    '-o', 'jsonpath={.spec.ports[*].port}',
  ]);
  const endpoints = run('kubectl', [
    ...prefix, 'get', 'endpointslice', '-n', namespace,
    '-l', 'kubernetes.io/service-name=langchain-agent',
    '-o', 'jsonpath={range .items[*].endpoints[*]}{.conditions.ready}:{.addresses[*]}{"\\n"}{end}',
  ]);
  const ready = service.status === 0 && /(^|\n)true:/.test(endpoints.stdout);
  return {
    ready,
    detail: ready
      ? `service ports ${service.stdout.trim()}; ready endpoint present`
      : (service.stderr || endpoints.stderr || 'no ready endpoint').trim(),
  };
}

function printCheck(label, response, expected) {
  const ok = expected.includes(response.status);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: HTTP ${response.status || 'unreachable'}`);
  if (response.error) console.log(`      ${response.error}`);
  return ok;
}

export function main(argv = process.argv.slice(2)) {
  const frontend = (process.env.PRIVILEGE_LANGCHAIN_FRONTEND || DEFAULT_FRONTEND).replace(/\/$/, '');
  const gateway = (process.env.PRIVILEGE_LANGCHAIN_GATEWAY || DEFAULT_GATEWAY).replace(/\/$/, '');
  const namespace = process.env.PRIVILEGE_LANGCHAIN_NAMESPACE || 'ping-devops-cmuir';
  const context = process.env.KUBECTL_CONTEXT || '';
  const skipK8s = argv.includes('--skip-k8s');

  console.log('Privilege LangChain login probe (read-only)\n');
  const base = curl(`${frontend}/a2a`);
  const card = curl(`${frontend}/a2a/.well-known/agent-card.json`);
  const rpc = curl(`${gateway}/langchainagent/a2a/jsonrpc`);
  printCheck('bare frontend /a2a (diagnostic)', base, [401, 404]);
  printCheck('frontend Agent Card', card, [200]);
  printCheck('gateway JSON-RPC OAuth challenge', rpc, [401]);

  const challenge = rpc.headers['www-authenticate'] || '';
  const authorizationUri = quotedChallengeValue(challenge, 'authorization_uri');
  const resourceMetadata = quotedChallengeValue(challenge, 'resource_metadata');
  console.log(`${authorizationUri ? 'PASS' : 'FAIL'}  authorization_uri advertised${authorizationUri ? `: ${authorizationUri}` : ''}`);
  console.log(`${resourceMetadata ? 'PASS' : 'FAIL'}  resource_metadata advertised${resourceMetadata ? `: ${resourceMetadata}` : ''}`);

  let metadataStatus = 0;
  if (resourceMetadata) {
    const metadata = curl(resourceMetadata);
    metadataStatus = metadata.status;
    printCheck('protected-resource metadata', metadata, [200]);
  }

  // A bare authorization request lacks OAuth parameters and should fail fast.
  if (authorizationUri) {
    const authorize = curl(authorizationUri);
    printCheck('bare authorize endpoint (expected parameter rejection)', authorize, [400]);
  }

  let k8sReady;
  if (!skipK8s) {
    const k8s = checkK8s(namespace, context);
    k8sReady = k8s.ready;
    console.log(`${k8s.ready ? 'PASS' : 'FAIL'}  Kubernetes backend: ${k8s.detail}`);
  }

  const failures = classify({
    base: base.status,
    card: card.status,
    rpc: rpc.status,
    authorizationUri,
    resourceMetadata,
    metadata: metadataStatus,
    k8s: k8sReady,
  });

  console.log('\nDiagnosis:');
  if (base.status === 401) {
    console.log('- Bare /a2a reaches the BFF-only gate; this is expected with the current service. Use the full Agent Card URL.');
  }
  if (failures.length === 0) {
    console.log('Network, backend, discovery, and OAuth bootstrap are healthy.');
    console.log('If the console Login button still fails, inspect its first failed Network request.');
    console.log(`The registered PingOne redirect URI must exactly match ${gateway}/langchainagent/callback`);
  } else {
    for (const failure of failures) console.log(`- ${failure}`);
  }
  console.log('- Never configure x-internal-gateway-secret on a public Privilege route.');
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
