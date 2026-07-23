// demo_api_ui/src/posthogClient.js
/**
 * Browser PostHog client. No-ops when REACT_APP_POSTHOG_KEY is unset.
 * Project tokens (phc_*) are safe in the frontend; never put personal API keys here.
 */
import posthog from 'posthog-js';

const KEY = process.env.REACT_APP_POSTHOG_KEY || '';
const HOST = process.env.REACT_APP_POSTHOG_HOST || 'https://us.i.posthog.com';

let initialized = false;

/** Initialize PostHog once for product + LLM-related browser analytics. */
export function initPosthog() {
  if (initialized) return posthog;
  if (!KEY) {
    if (process.env.NODE_ENV !== 'production') {
      // Loud in dev so missing config is obvious; production stays silent no-op.
      // eslint-disable-next-line no-console
      console.warn(
        'REACT_APP_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once REACT_APP_POSTHOG_KEY is configured',
      );
    }
    return null;
  }
  posthog.init(KEY, {
    api_host: HOST,
    defaults: '2026-05-30',
    capture_pageview: true,
  });
  initialized = true;
  return posthog;
}

export default posthog;
