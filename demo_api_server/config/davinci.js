// DaVinci orchestration showcase — env config, lazy getters (mirrors config/oauth.js).
// See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
'use strict';

const configStore = require('../services/configStore');

const config = {
  get apiClientId()     { return process.env.PINGONE_DAVINCI_API_CLIENT_ID; },
  get apiClientSecret() { return process.env.PINGONE_DAVINCI_API_CLIENT_SECRET; },

  get transaction() {
    return {
      companyId: process.env.PINGONE_DAVINCI_TRANSACTION_COMPANY_ID,
      appId:     process.env.PINGONE_DAVINCI_TRANSACTION_APP_ID,
      flowId:    process.env.PINGONE_DAVINCI_TRANSACTION_FLOW_ID,
    };
  },

  // Widget invocation (skRenderScreen) needs companyId + a per-version Flow
  // Policy id; apiKey is the DaVinci API key sent as X-SK-API-KEY when minting
  // an SDK token server-side. appId/flowId* stay for the OIDC app backing the
  // flow's terminal PingOne Authentication node (the code /callback exchanges).
  get login() {
    return {
      appId:      process.env.PINGONE_DAVINCI_LOGIN_APP_ID,
      flowIdV1:   process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V1,
      flowIdV2:   process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V2,
      companyId:  process.env.PINGONE_DAVINCI_LOGIN_COMPANY_ID,
      policyIdV1: process.env.PINGONE_DAVINCI_LOGIN_POLICY_ID_V1,
      policyIdV2: process.env.PINGONE_DAVINCI_LOGIN_POLICY_ID_V2,
      apiKey:     process.env.PINGONE_DAVINCI_API_KEY,
    };
  },

  get webhookUrl() {
    if (process.env.DAVINCI_WEBHOOK_URL) return process.env.DAVINCI_WEBHOOK_URL;
    const base = configStore.getEffective('pingone_public_app_url') || '';
    return `${base}/webhook/davinci`;
  },
};

module.exports = config;
