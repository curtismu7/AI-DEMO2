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
  '/api/auth/hosted-registration/request',
  '/api/auth/hosted-registration/verify',
  '/api/auth/hosted-registration/resend',
  '/api/auth/hosted-registration/status',
  '/request-access',
  // CIMD client documents Privilege fetches anonymously, one exact path per agent.
  '/api/cimd/privilege/super-banking-ai-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-investment-advisor-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-records-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-purchase-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-membership-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-payroll-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-tax-records-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-financial-aid-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-supplier-contract-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-holdings-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-passenger-records-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-fraud-watch-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-balance-sweep-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-agent/client-metadata.json',
  '/api/cimd/privilege/super-banking-identity-verification-specialist-agent/client-metadata.json',
  '/api/cimd/privilege/langchain-agent/client-metadata.json',
  '/api/cimd/privilege/demo-agent-service/client-metadata.json',
  '/api/cimd/privilege/privilege-mcp-client/client-metadata.json',
];
const REQUIRED_PUBLIC_PREFIXES = ['/assets'];

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
  const actualExactBypasses = bypassPaths.filter((entry) => entry.pathType === 'Exact').map((entry) => entry.path).sort();
  const actualPublicPrefixes = bypassPaths.filter((entry) => entry.pathType === 'Prefix').map((entry) => entry.path).sort();
  if (JSON.stringify(actualExactBypasses) !== JSON.stringify([...REQUIRED_BYPASSES].sort())) {
    errors.push(`OAuth bypass paths must be exactly: ${REQUIRED_BYPASSES.join(', ')}`);
  }
  if (JSON.stringify(actualPublicPrefixes) !== JSON.stringify([...REQUIRED_PUBLIC_PREFIXES].sort())) {
    errors.push(`public static bypass paths must be exactly: ${REQUIRED_PUBLIC_PREFIXES.join(', ')}`);
  }
  if (bypassPaths.some((entry) => entry.pathType !== 'Exact' && entry.pathType !== 'Prefix')) {
    errors.push('OAuth bypass paths must use pathType Exact or an explicitly approved public Prefix');
  }
  if (mcp?.metadata?.annotations?.['nginx.ingress.kubernetes.io/auth-url']) {
    errors.push('MCP public ingress must remain outside the hosted browser gate');
  }

  const config = loadDocuments(configFile).find((doc) => doc?.kind === 'ConfigMap' && doc.metadata?.name === 'ai-demo-config');
  if (config?.data?.HOSTED_ACCESS_GATE_ENABLED != null) errors.push('shared Kubernetes ConfigMap must leave hosted access disabled');
  const seDeploy = fs.readFileSync(seDeployFile, 'utf8');
  for (const required of [
    'HOSTED_ACCESS_GATE_ENABLED',
    'HOSTED_ACCESS_ALLOWED_DOMAINS',
    'pingidentity.com',
    'HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL',
    'HOSTED_ACCESS_REQUIRED_GROUP_ID',
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
