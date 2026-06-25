<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the `banking_api_server` Node.js backend. A new PostHog client singleton was created in `banking_api_server/services/posthog.js`, and event tracking, user identification, and error capture were added to five route files and one middleware file. All credentials are read from environment variables.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `user_logged_in` | User successfully authenticated via local username/password login | `banking_api_server/routes/auth.js` |
| `user_registered` | New user created a local account via registration form | `banking_api_server/routes/auth.js` |
| `password_changed` | Authenticated user successfully changed their password | `banking_api_server/routes/auth.js` |
| `oauth_login_completed` | Admin user completed OAuth login via PingOne (callback succeeded) | `banking_api_server/routes/oauth.js` |
| `user_logged_out` | User initiated logout and session was destroyed | `banking_api_server/routes/oauth.js` |
| `transaction_created` | User created a deposit or withdrawal transaction | `banking_api_server/routes/transactions.js` |
| `transfer_completed` | User completed a funds transfer between accounts | `banking_api_server/routes/transactions.js` |
| `consent_challenge_created` | HITL consent challenge created for a high-value transaction | `banking_api_server/routes/transactions.js` |
| `consent_challenge_confirmed` | User confirmed a HITL consent challenge (OTP sent) | `banking_api_server/routes/transactions.js` |
| `mfa_challenge_initiated` | User initiated an MFA step-up authentication challenge | `banking_api_server/routes/mfa.js` |
| `mfa_challenge_completed` | User successfully completed an MFA step-up challenge | `banking_api_server/routes/mfa.js` |
| `mfa_device_enrolled` | User successfully enrolled a new MFA device (SMS, email, or FIDO2) | `banking_api_server/routes/mfa.js` |
| `demo_reset` | User reset their demo accounts back to starting balances | `banking_api_server/routes/accounts.js` |

## Files changed

- `banking_api_server/services/posthog.js` — **new** PostHog client singleton
- `banking_api_server/routes/auth.js` — `user_logged_in`, `user_registered` (with `identify`), `password_changed`
- `banking_api_server/routes/oauth.js` — `oauth_login_completed` (with `identify`), `user_logged_out`
- `banking_api_server/routes/transactions.js` — `transaction_created`, `transfer_completed`, `consent_challenge_created`, `consent_challenge_confirmed`
- `banking_api_server/routes/mfa.js` — `mfa_challenge_initiated`, `mfa_challenge_completed`, `mfa_device_enrolled`
- `banking_api_server/routes/accounts.js` — `demo_reset`
- `banking_api_server/middleware/oauthErrorHandler.js` — `captureException` for unexpected server errors
- `banking_api_server/.env` — `POSTHOG_API_KEY` and `POSTHOG_HOST` added

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/410572/dashboard/1546270
- **Daily Logins** (local + OAuth trends): https://us.posthog.com/project/410572/insights/7NTjMpCK
- **Registration to Login Funnel:** https://us.posthog.com/project/410572/insights/ZtC8DsEM
- **Transaction Volume Over Time:** https://us.posthog.com/project/410572/insights/vEVeM5N8
- **MFA Device Enrollment by Type:** https://us.posthog.com/project/410572/insights/BcnBqPQO
- **HITL Consent Challenge Funnel:** https://us.posthog.com/project/410572/insights/nrQReowL

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
