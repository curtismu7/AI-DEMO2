#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Idempotently provision PingOne Agent Consent + Agent-Consent-Login
 * and assign to Super Banking User App.
 *
 *   cd demo_api_server && node scripts/ensureAgentConsentAgreement.js
 */

const { loadDemoEnv } = require('./loadDemoEnv');
loadDemoEnv();

const { PingOneProvisionService } = require('../services/pingoneProvisionService');
const { AGREEMENT_NAME, POLICY_NAME } = require('../config/agentConsentAgreement');

async function main() {
  const envId =
    process.env.PINGONE_ENVIRONMENT_ID ||
    process.env.PINGONE_ENV_ID ||
    process.env.PINGONE_BOOTSTRAP_ENV_ID;
  const region = process.env.PINGONE_REGION || process.env.PINGONE_BOOTSTRAP_REGION || 'com';
  const clientId =
    process.env.PINGONE_WORKER_CLIENT_ID ||
    process.env.PINGONE_BOOTSTRAP_CLIENT_ID ||
    process.env.PINGONE_ADMIN_CLIENT_ID;
  const clientSecret =
    process.env.PINGONE_WORKER_CLIENT_SECRET ||
    process.env.PINGONE_BOOTSTRAP_CLIENT_SECRET ||
    process.env.PINGONE_ADMIN_CLIENT_SECRET;
  const userAppId =
    process.env.PINGONE_USER_CLIENT_ID ||
    process.env.PINGONE_ENDUSER_CLIENT_ID;

  if (!envId || !clientId || !clientSecret) {
    console.error('Missing PingOne worker creds (env id + worker client id/secret)');
    process.exit(1);
  }
  if (!userAppId) {
    console.error('Missing PINGONE_USER_CLIENT_ID in .env');
    process.exit(1);
  }

  const svc = new PingOneProvisionService();
  svc.envId = envId;
  svc.region = region;
  svc.baseURL = `https://api.pingone.${region}/v1/environments/${envId}`;
  svc.workerToken = await svc.getWorkerToken(envId, clientId, clientSecret, region);

  console.log(`Provisioning ${AGREEMENT_NAME} / ${POLICY_NAME} for User app ${userAppId}…`);
  const result = await svc.ensureAgentConsentLoginForApp(userAppId);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
