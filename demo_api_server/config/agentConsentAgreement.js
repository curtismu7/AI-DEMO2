// demo_api_server/config/agentConsentAgreement.js
/**
 * PingOne Agreement text for login-time agent consent (IDAI Agent Consent).
 *
 * Mirrors the legacy "Allow AI Agent Access" copy in
 * demo_api_ui/src/components/AgentConsentModal.js — session-scoped agent
 * access. Per-tool HITL / transfer consent remains separate and is not
 * replaced by this agreement.
 */

'use strict';

const AGREEMENT_NAME = 'Agent Consent';
const AGREEMENT_DESCRIPTION =
  'Consent for the Super Banking AI Banking Assistant to act on the user’s behalf';
const POLICY_NAME = 'Agent-Consent-Login';
const POLICY_DESCRIPTION =
  'Login then Agreement Prompt — user accepts Agent Consent before delegated agent access';
/** Match IDAI tutorial default (180 days). */
const RECONSENT_PERIOD_DAYS = 180;
const DISPLAY_NAME = 'Allow AI Agent Access';
const LOCALE = 'en';

/**
 * HTML body shown in the PingOne Agreement Prompt.
 * Keep tags to PingOne’s supported set (p, b, h1–h3, br, a) — ul/li/strong
 * are rejected as “unsupported HTML”.
 */
const AGREEMENT_HTML = [
  '<h1>Allow AI Agent Access</h1>',
  '<p>The <b>AI Banking Assistant</b> is requesting permission to act on your behalf — checking balances, viewing transactions, and initiating transfers.</p>',
  '<p>The agent can only act within this session.</p>',
  '<p>All actions are logged and visible in the Token Chain display.</p>',
  '<p>You can revoke access at any time by logging out.</p>',
  '<p>The agent cannot change your credentials or contact details.</p>',
  '<p>High-risk actions (for example large transfers) still require a separate in-app approval and one-time code.</p>',
  '<p>I consent to allow digital assistants created by Super Banking to act on my behalf within the limits above.</p>',
].join('\n');

module.exports = {
  AGREEMENT_NAME,
  AGREEMENT_DESCRIPTION,
  POLICY_NAME,
  POLICY_DESCRIPTION,
  RECONSENT_PERIOD_DAYS,
  DISPLAY_NAME,
  LOCALE,
  AGREEMENT_HTML,
};
