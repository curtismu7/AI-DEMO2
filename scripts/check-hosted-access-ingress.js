#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED_BYPASSES = [
  '/api/auth/hosted-access/login',
  '/api/auth/hosted-access/callback',
  '/api/auth/hosted-access/logout',
];

function loadDocuments(file) {
  return YAML.parseAllDocuments(fs.readFileSync(file, 'utf8')).map((doc) => doc.toJS());
}

function verifyHostedAccess({ ingressFile, configFile, seDeployFile }) {
  const errors = [];
  const ingresses = loadDocuments(ingressFile).filter((doc) => doc?.kind === 'Ingress');
  const app = ingresses.find((doc) => doc.metadata?.name === 'ai-demo-ingress');
  const bypass = ingresses.find((doc) => doc.metadata?.name === 'ai-demo-oauth-bypass-ingress');
  const mcp = ingresses.find((doc) => doc.metadata?.name === 'mcp-public-door-ingress');
  const annotations = app?.metadata?.annotations || {};

  if (!app) errors.push('missing ai-demo-ingress');
  if (!String(annotations['nginx.ingress.kubernetes.io/auth-url'] || '').endsWith('/api/auth/hosted-access/check')) {
    errors.push('ai-demo-ingress must use the hosted-access check as auth-url');
  }
  if (!String(annotations['nginx.ingress.kubernetes.io/auth-signin'] || '').startsWith('https://ai-demo.ping-devops.com/api/auth/hosted-access/login')) {
    errors.push('ai-demo-ingress must send unauthenticated browsers to the hosted front-door login');
  }

  const bypassRules = bypass?.spec?.rules || [];
  const bypassPaths = bypassRules.flatMap((rule) =>
    rule.host === 'ai-demo.ping-devops.com' ? (rule.http?.paths || []) : []);
  if (!bypass) errors.push('missing ai-demo-oauth-bypass-ingress');
  if (bypass?.metadata?.annotations?.['nginx.ingress.kubernetes.io/auth-url']) {
    errors.push('OAuth bypass ingress must not carry an auth-url annotation');
  }
  const actualBypasses = bypassPaths.map((entry) => entry.path).sort();
  if (JSON.stringify(actualBypasses) !== JSON.stringify([...REQUIRED_BYPASSES].sort())) {
    errors.push(`OAuth bypass paths must be exactly: ${REQUIRED_BYPASSES.join(', ')}`);
  }
  if (bypassPaths.some((entry) => entry.pathType !== 'Exact')) {
    errors.push('every OAuth bypass path must use pathType Exact');
  }
  if (mcp?.metadata?.annotations?.['nginx.ingress.kubernetes.io/auth-url']) {
    errors.push('MCP public ingress must remain outside the hosted browser gate');
  }

  const config = loadDocuments(configFile).find((doc) => doc?.kind === 'ConfigMap' && doc.metadata?.name === 'ai-demo-config');
  if (config?.data?.HOSTED_ACCESS_GATE_ENABLED != null) errors.push('shared Kubernetes ConfigMap must leave hosted access disabled');
  const seDeploy = fs.readFileSync(seDeployFile, 'utf8');
  for (const required of [
    '"HOSTED_ACCESS_GATE_ENABLED":"true"',
    '"HOSTED_ACCESS_ALLOWED_DOMAINS":"pingidentity.com,pingone.com"',
    '"HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL":"true"',
  ]) {
    if (!seDeploy.includes(required)) errors.push(`SE deploy patch missing ${required}`);
  }
  return errors;
}

if (require.main === module) {
  const errors = verifyHostedAccess({
    ingressFile: path.join(ROOT, 'k8s/aws/se-ingress.yaml'),
    configFile: path.join(ROOT, 'k8s/02-configmap.yaml'),
    seDeployFile: path.join(ROOT, 'k8s/aws/deploy.sh'),
  });
  if (errors.length) {
    console.error(`Hosted access ingress verification failed:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Hosted access ingress verification passed');
}

module.exports = { REQUIRED_BYPASSES, verifyHostedAccess };
