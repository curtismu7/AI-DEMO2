'use strict';

/**
 * All deployment origins whose redirect URIs must be registered in PingOne.
 * Single source of truth — imported by pingoneProvisionService, pingoneAppConfigService,
 * and ensureAllRedirectUris so they can never diverge.
 *
 * Add a new row here whenever a new deployment target is introduced.
 */
const KNOWN_REDIRECT_ORIGINS = [
  'https://demo-api-server:3001',      // local dev
  'https://ai-demo.ping-devops.com',   // SE DevOps cluster (Ping AWS / k8s)
];

module.exports = { KNOWN_REDIRECT_ORIGINS };
