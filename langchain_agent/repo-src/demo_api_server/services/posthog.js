'use strict';

const noop = () => {};
const noopAsync = async () => {};

// No-op stub used when POSTHOG_API_KEY is absent (test environments, local dev without analytics).
const stub = {
  capture: noop, identify: noop, alias: noop, group: noop,
  groupIdentify: noop, reloadFeatureFlags: noop, isFeatureEnabled: noop,
  getFeatureFlag: noop, getFeatureFlagPayload: noop,
  shutdown: noopAsync, flush: noopAsync,
};

let client = stub;

if (process.env.POSTHOG_API_KEY) {
  const { PostHog } = require('posthog-node');
  client = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
  });

  process.on('SIGINT', async () => { await client.shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await client.shutdown(); process.exit(0); });
}

module.exports = client;
