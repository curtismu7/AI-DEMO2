# Regression — API & Session Tests

## Automated (no browser, no server needed)

From repo root:

```bash
npm run test:session
```

Covers: `authSession` (including BFF store ping contract), `authStateCookie`,
`bffSessionGating`, `upstashSessionStore`, `session-store-resilience`,
`oauth-e2e-integration`.

Run the full API server Jest suite (includes OAuth scope, step-up, and HITL flows):

```bash
cd banking_api_server && npm test -- --forceExit
```

Run **only** before a release when changing:
- `routes/transactions.js`
- `transactionConsentChallenge.js`
- `middleware/auth` scope rules

## API smoke (server must be running)

Session-only (fastest):

```bash
cd banking_api_ui && BANKING_API_BASE=http://127.0.0.1:3001 npm run test:e2e:session
```

Full Playwright API config (includes `session-regression.spec.js` and other API specs):

```bash
cd banking_api_ui && BANKING_API_BASE=http://127.0.0.1:3001 npm run test:e2e:api
```

Adjust `BANKING_API_BASE` to your API port.

## What tests cannot catch

- Redis `SET` failures that still call `session.save` success (store swallows errors).
  Rely on logs (`[session-store] Upstash SET error`) and the debug endpoint.
- Token expiry races between the BFF session store and PingOne's revocation endpoint.
