/**
 * emailService.js — Transaction confirmation emails via PingOne Notifications API
 *
 * Uses the PingOne Management API to send email directly to the PingOne user
 * identified by their sub (userId). No external email provider needed — PingOne
 * handles delivery using its own configured email sender.
 *
 * API: POST /v1/environments/{envId}/users/{userId}/messages
 * Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-send-user-message
 *
 * Required: the worker app (pingone_client_id / pingone_client_secret) must have
 * the "Notifications" scope: p1:create:userMessage
 *
 * If PingOne credentials are not configured, emails are silently skipped.
 */

'use strict';

const axios = require('axios');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const configStore = require('./configStore');
const { getTokenEndpoint } = require('./oauthEndpointResolver');

// ── Management token (reuses the worker client credentials) ──────────────────
async function getManagementToken() {
  const envId        = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  // Use PINGONE_ADMIN_CLIENT_ID / PINGONE_ADMIN_CLIENT_SECRET — the keys that map to PINGONE_*_CLIENT_ID env vars.
  // 'PINGONE_MANAGEMENT_CLIENT_ID' is not in the configStore env-fallback map and always returns null.
  const clientId     = configStore.getEffective('PINGONE_ADMIN_CLIENT_ID');
  const clientSecret = configStore.getEffective('PINGONE_ADMIN_CLIENT_SECRET');

  if (!envId || !clientId || !clientSecret) {
    // Admin creds not configured in this environment — fall back to the MFA
    // worker token, which is provisioned and proven (it drives FIDO2/device
    // enrollment). Sending /users/{id}/messages needs the worker app to hold an
    // identity role; if it doesn't, the POST throws and the caller surfaces it
    // (no silent skip).
    try {
      const { getWorkerToken } = require('./mfaService');
      const workerToken = await getWorkerToken();
      if (workerToken) return workerToken;
    } catch (e) {
      console.warn('[emailService] worker-token fallback failed:', e.message);
    }
    return null;
  }

  const tokenUrl = getTokenEndpoint();
  const response = await axios.post(
    tokenUrl,
    'grant_type=client_credentials',
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  return response.data.access_token;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml({ type, amount, fromAccount, toAccount, newBalance, transactionId, userName, date }) {
  const typeLabels = { transfer: 'Transfer', deposit: 'Deposit', withdrawal: 'Withdrawal' };
  const typeColors = { transfer: '#277ba5', deposit: '#16a34a', withdrawal: '#dc2626' };
  const typeIcons  = { transfer: '↔', deposit: '⬇', withdrawal: '⬆' };

  const label = typeLabels[type] || type;
  const color = typeColors[type] || '#277ba5';
  const icon  = typeIcons[type]  || '💰';

  // Sanitize user-controlled values to prevent XSS
  const safeUserName = escapeHtml(userName);
  const safeFromAccount = escapeHtml(fromAccount);
  const safeToAccount = escapeHtml(toAccount);
  const safeTransactionId = escapeHtml(transactionId);

  let accountRows = '';
  if (type === 'transfer' && fromAccount && toAccount) {
    accountRows = `
      <tr><td style="color:#6b7280;padding:4px 0">From</td><td style="padding:4px 0"><strong>${safeFromAccount}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">To</td><td style="padding:4px 0"><strong>${safeToAccount}</strong></td></tr>`;
  } else if (toAccount) {
    accountRows = `<tr><td style="color:#6b7280;padding:4px 0">Account</td><td style="padding:4px 0"><strong>${safeToAccount}</strong></td></tr>`;
  } else if (fromAccount) {
    accountRows = `<tr><td style="color:#6b7280;padding:4px 0">Account</td><td style="padding:4px 0"><strong>${safeFromAccount}</strong></td></tr>`;
  }

  const balanceRow = newBalance !== undefined
    ? `<tr><td style="color:#6b7280;padding:4px 0">New Balance</td><td style="padding:4px 0"><strong>${formatCurrency(newBalance)}</strong></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
      <tr><td style="background:linear-gradient(135deg,#1a5d80,${color});padding:28px 32px">
        <div style="color:#fff;font-size:13px;opacity:.8;margin-bottom:4px">Super Banking</div>
        <div style="color:#fff;font-size:22px;font-weight:700">${icon} ${label} Confirmation</div>
      </td></tr>
      <tr><td style="padding:28px 32px">
        <p style="margin:0 0 20px;color:#374151;font-size:15px">Hi ${safeUserName},</p>
        <p style="margin:0 0 24px;color:#374151;font-size:15px">
          Your ${label.toLowerCase()} of <strong style="color:${color}">${formatCurrency(amount)}</strong> was processed successfully.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;padding-top:16px">
          <tr><td style="color:#6b7280;padding:4px 0">Amount</td><td style="padding:4px 0"><strong style="color:${color}">${formatCurrency(amount)}</strong></td></tr>
          ${accountRows}
          ${balanceRow}
          <tr><td style="color:#6b7280;padding:4px 0">Date</td><td style="padding:4px 0">${date}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 0">Reference</td><td style="padding:4px 0"><code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px">${safeTransactionId}</code></td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:12px">This is an automated confirmation from Super Banking Demo. Do not reply to this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Send a transaction confirmation email via PingOne Notifications API.
 *
 * @param {string} userId   PingOne user sub (req.user.id)
 * @param {object} opts
 * @param {'transfer'|'deposit'|'withdrawal'} opts.type
 * @param {number}  opts.amount
 * @param {string}  [opts.fromAccount]
 * @param {string}  [opts.toAccount]
 * @param {number}  [opts.newBalance]
 * @param {string}  opts.transactionId
 * @param {string}  opts.userName
 */
async function sendTransactionConfirmation(userId, opts) {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';

  if (!envId || !userId) return; // not configured — silently skip

  const typeLabels = { transfer: 'Transfer', deposit: 'Deposit', withdrawal: 'Withdrawal' };
  const label = typeLabels[opts.type] || opts.type;
  const date  = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  try {
    const token = await getManagementToken();
    if (!token) return;

    await axios.post(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}/messages`,
      {
        content: [
          {
            deliveryMethod: 'Email',
            subject: `${label} Confirmation — ${formatCurrency(opts.amount)}`,
            body: buildEmailHtml({ ...opts, date }),
            charset: 'UTF-8',
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log(`📧 [Email] PingOne notification sent to user ${userId} — ${label} ${formatCurrency(opts.amount)}`);
  } catch (err) {
    // Never let email failure break the transaction response
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`📧 [Email] PingOne notification failed for user ${userId}: ${detail}`);
  }
}

/**
 * Send a 6-digit OTP for high-value transaction verification.
 *
 * @param {string} userId   PingOne user sub (req.user.id)
 * @param {object} opts
 * @param {string}  opts.otpCode        6-digit numeric code
 * @param {number}  opts.amount         Transaction amount
 * @param {string}  opts.transactionType 'transfer' | 'deposit' | 'withdrawal'
 * @param {string}  [opts.userName]     Greeting name
 * @param {number}  [opts.expiresInMin] Minutes until code expires (default 5)
 * @returns {Promise<void>}
 */
async function sendOtpEmail(userId, opts) {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';

  if (!envId || !userId) return;

  const { otpCode, amount, transactionType = 'transaction', userName = 'Valued Customer', expiresInMin = 5 } = opts;
  const label = { transfer: 'Transfer', deposit: 'Deposit', withdrawal: 'Withdrawal' }[transactionType] || 'Transaction';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
      <tr><td style="background:linear-gradient(135deg,#1a5d80,#dc2626);padding:28px 32px">
        <div style="color:#fff;font-size:13px;opacity:.8;margin-bottom:4px">Super Banking — Security</div>
        <div style="color:#fff;font-size:22px;font-weight:700">🔒 Transaction Verification Code</div>
      </td></tr>
      <tr><td style="padding:28px 32px">
        <p style="margin:0 0 16px;color:#374151;font-size:15px">Hi ${userName},</p>
        <p style="margin:0 0 20px;color:#374151;font-size:15px">
          You requested to authorize a high-value <strong>${label}</strong> of
          <strong style="color:#dc2626">${formatCurrency(amount)}</strong>.
          Enter the code below to confirm.
        </p>
        <div style="text-align:center;margin:24px 0">
          <div style="display:inline-block;background:#f0f9ff;border:2px solid #0ea5e9;border-radius:12px;padding:16px 40px">
            <div style="font-size:36px;font-weight:800;letter-spacing:0.28em;color:#0369a1;font-variant-numeric:tabular-nums">${otpCode}</div>
          </div>
        </div>
        <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center">
          This code expires in <strong>${expiresInMin} minutes</strong>. Do not share it with anyone.
        </p>
        <p style="margin:20px 0 0;color:#dc2626;font-size:13px;border-top:1px solid #fee2e2;padding-top:16px">
          ⚠️ If you did not initiate this transaction, ignore this email and contact support immediately.
        </p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:12px">This is an automated security message from Super Banking Demo. Do not reply.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const token = await getManagementToken();
    if (!token) {
      // No silent skip — the caller must learn the code was not delivered.
      console.error(`📧 [OTP Email] No management/worker token available — cannot send OTP for user ${userId}`);
      throw Object.assign(
        new Error('OTP email could not be sent: no PingOne management or worker token is configured.'),
        { code: 'otp_delivery_unconfigured' },
      );
    }
    await axios.post(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}/messages`,
      {
        content: [
          {
            deliveryMethod: 'Email',
            subject: `Super Banking — Your verification code: ${otpCode}`,
            body: html,
            charset: 'UTF-8',
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`📧 [OTP Email] Sent to user ${userId} — ${label} ${formatCurrency(amount)}`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`📧 [OTP Email] Failed for user ${userId}: ${detail}`);
    // Re-throw so caller can return 503 instead of silently proceeding without OTP
    throw normalizeAxiosError(err, { label: 'OTP email delivery' });
  }
}

async function sendOtpSms(userId, opts) {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';

  if (!envId || !userId) return;

  const { otpCode, userName = 'Valued Customer', expiresInMin = 5 } = opts;

  try {
    const token = await getManagementToken();
    if (!token) {
      console.warn(`📱 [OTP SMS] No management token available — OTP SMS skipped for user ${userId}`);
      return;
    }
    await axios.post(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}/messages`,
      {
        content: [
          {
            deliveryMethod: 'SMS',
            body: `Super Banking: Your verification code is ${otpCode}. Expires in ${expiresInMin} minutes. Do not share this code.`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`📱 [OTP SMS] Sent to user ${userId}`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`📱 [OTP SMS] Failed for user ${userId}: ${detail}`);
    throw normalizeAxiosError(err, { label: 'OTP SMS delivery' });
  }
}

module.exports = { sendTransactionConfirmation, sendOtpEmail, sendOtpSms };
