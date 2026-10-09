# User API Key & Secrets Tab — Design Spec
**Date:** 2026-09-29
**Status:** Awaiting spec review

---

## Goal

Add a **User API Key & Secrets** tab to the Agent Privilege client. It guides the
operator through the user API key token flow from the User API Key & Secret
Management PDF, runs the equivalent requests, and displays the Privilege users
response.

**Done when:** an operator can enter an Environment ID and User ID, see whether
the vault credentials are configured (with masked previews), set or replace
either credential in the encrypted vault, run the token and users-list
sequence, see each step's status, and inspect the returned users JSON. The JWT
and saved credentials are shown only as partially masked previews.

## Scope

### In scope

- Add a third demo tab titled **User API Key & Secrets** to the Agent Privilege
  client, alongside its existing Agent Chat and Tools tabs.
- Provide Environment ID and User ID (UUID) inputs. Use namespace `default` and
  TTL `3600`, matching the supplied Go demo.
- Read the user API key and secret only from the encrypted application vault as
  entries named `PRIVILEGE_USER_API_KEY` and `PRIVILEGE_USER_API_SECRET`.
- Let an authenticated administrator set or replace either named entry from
  the tab. Require the current vault password for each save, and write only to
  the encrypted vault.
- Allow replacing the key or secret independently: an empty field means
  "leave the stored value unchanged"; reject a save with both credential
  fields empty.
- Show the PDF's four numbered command stages: `go run main.go encrypt`, the
  token-endpoint cURL POST, `go run main.go decrypt`, and the users-endpoint
  cURL GET. Mask the API key, API secret, encrypted request data, and JWT in
  every displayed preview.
- Provide one **Run token and list users** action. The BFF performs the full
  sequence and returns the users response plus progress/status data and masked
  value previews.
- Default the server-side controller URL to
  `https://privilege.test-one-pingone.com`, as used by the supplied PDF. Allow
  deployments to override it with `PRIVILEGE_USER_API_BASE_URL`; the browser
  cannot choose the outbound host.

### Out of scope

- Creating, rotating, or revoking user API keys in the Privilege Admin Console.
- A general Privilege API explorer, arbitrary endpoint/method selection, or
  arbitrary shell/Go command execution.
- Returning a complete JWT or complete API credential to the browser, storing
  any of them in browser storage, or persisting token-flow results.
- Generic vault entry CRUD, deletion, arbitrary vault key writes, or changes to
  other vault management workflows. The save operation is restricted to the
  two Privilege user API credential entries.
- The separate Privilege LLM virtual-key protection flow.

## UI and interaction

The new tab presents:

1. Environment ID and User ID fields. The User ID is the Privilege user UUID
   that owns the configured API key; an email address is not accepted.
2. Vault configuration status, with the first and last few characters of each
   saved value retained and the middle obscured. A missing entry or unavailable
   vault is clearly called out.
3. Two initially blank password fields for API key and API secret, plus a
   current vault password field and **Save to Vault** action. An administrator
   can replace either credential independently. Successful saves clear all
   fields and show updated masked previews; after any save attempt the vault
   password field is cleared. Values are never prefilled in the editor.
4. The PDF's four numbered command previews. They show the source Go command
   forms and cURL request shapes with masked dynamic values. The Run action
   executes the equivalent crypto and HTTP steps inside the BFF; it does not
   launch a local shell or run arbitrary commands.
5. A progress/result area showing encryption, token-request, decryption, and
   user-list statuses; a partially masked JWT preview; the Privilege HTTP
   status; and the returned JSON users list on success.

The page does not offer a reveal control. Credential inputs start blank and
are not written to browser storage. A fresh Run creates a fresh nonce,
timestamp, encrypted request, and JWT. Results live only in the current page
state and BFF request memory.

## BFF and request flow

The encrypted vault is the only persistent store for the API key and secret.
The BFF decrypts entries into its in-memory config cache at startup. All page
routes require an authenticated administrator and use the app's CSRF
protections:

- A configuration-status route reports whether both credentials are present
  in the vault-loaded cache and returns only masked previews and the effective
  controller URL.
- A credential-save route accepts `api_key`, `api_secret`, and
  `current_password`. It requires at least one non-empty credential field and
  accepts no vault path or arbitrary entry names. The current vault password
  is used for this request only and is never retained.
- A run route accepts only the Environment ID and User ID. It does not accept
  arbitrary Privilege paths, HTTP methods, request bodies, or controller URLs.
- Credential reads use a vault-provenance-checked config-store accessor. They
  do not fall back to `.env`, process environment, or LMDB for these values,
  even if a same-named value is present there.

On Save, the BFF opens the configured vault with the supplied password,
upserts only the supplied Privilege credential entries, atomically saves the
vault, reloads its entries into the in-memory config cache with
`persist:false`, then closes the vault handle. This both refreshes the current
BFF process and zeroes vault key material. The password is not kept in a
session or process environment.

On Run, the BFF:

1. Validates the Environment ID and User ID as UUIDs and confirms both
   credentials are configured.
2. Creates a cryptographically random 32-byte nonce (hex encoded), an RFC3339
   timestamp, the configured API key, and TTL 3600 in the app-user-token
   request payload.
3. Uses OpenSSL-compatible AES-256-CBC with PBKDF2-SHA256 (10,000 iterations)
   to encrypt that payload with the API secret, matching the Go sample's
   `openssl.PBKDF2SHA256` format.
4. POSTs to
   `/pubapi/{environmentId}/v1/appusertoken` with the PDF's `ObjectMeta` and
   `GuestMetaReq` fields. The BFF generates a fresh
   `x-procyon-session-id` UUID for the request.
5. Decrypts `GuestMetaRes.EncResData`, verifies the echoed nonce, and obtains
   the JWT. A nonce mismatch fails the run before any users request.
6. GETs `/api/{environmentId}/v1/users` with
   `Authorization: Bearer <JWT>` and a fresh `x-procyon-session-id` UUID.
7. Returns the users JSON, stage statuses, HTTP status, and a masked JWT
   preview. It does not return the raw JWT, API key, API secret, or encrypted
   payload.

The outbound Privilege base URL is read from server configuration only. It
must be HTTPS. No URL or path received from the browser is used to construct
the outbound host or route.

## Errors and diagnostics

- Vault file missing or current vault password invalid: report a sanitized
  vault error, do not update either entry, and do not make a Privilege network
  request. Preserve the vault library's indistinguishable wrong-password and
  integrity-failure response.
- Missing credential entries: show the exact required vault entry names and
  stop before making a network request. The save form can create either entry.
- Save with both credential inputs empty: reject without opening the vault.
- Invalid Environment ID or User ID: identify the field and do not make a
  network request.
- Token endpoint failure: report the stage, HTTP status, and a sanitized
  message; do not display or log credential-bearing request/response bodies.
- Decryption or nonce validation failure: report token-generation failure and
  do not call the users endpoint.
- Users endpoint `401`: explain that Privilege rejected the JWT; expiry is one
  possible cause, but the operator should also verify the key, owning user,
  environment, and permissions. A new Run performs a fresh token exchange.
- Other non-2xx users responses: show the status and sanitized response detail
  when safe; do not include authorization headers or raw token material.
- Network timeout or TLS failure: identify the failing endpoint stage without
  dumping request headers or secrets.

## Security and privacy

- API credentials are stored encrypted at rest in `secrets.vault` (or the
  configured `VAULT_PATH`) and loaded into BFF memory at startup or after a
  successful save. They are never placed in `.env`, React build variables, or
  browser storage.
- Credential reads require vault provenance; process environment and LMDB
  values with the same names are ignored.
- Credential entry values and the vault password exist transiently in the
  browser form and the HTTPS save request. The form clears after success, and
  only masked credential previews are returned by BFF responses.
- The full JWT is held in BFF request memory only long enough to call the
  users endpoint; it is not stored in a session, returned, or logged.
- API key, API secret, and vault password fields must be redacted before data
  reaches BFF activity/API-explorer logs and browser traffic history/local
  storage. Request/response logging must also omit nonce payloads, JWTs,
  authorization headers, and user-list bodies. Vault audit entries record key
  names and operation results, never values.
- All page routes require the existing administrator authentication and CSRF
  protections. Save writes only the two named vault entries; Run remains fixed
  to token generation and listing users and cannot perform Privilege
  mutations or arbitrary requests.
- The users response is displayed to the authenticated operator and is not
  persisted by this feature.

## Credential setup and configuration

An authorized administrator can add or replace the API key and API secret in
the tab. The current vault password is entered for each Save operation and is
not retained. As a local operator fallback, the existing masked CLI remains
available from `demo_api_server/`:

```bash
npm run vault:set PRIVILEGE_USER_API_KEY
npm run vault:set PRIVILEGE_USER_API_SECRET
```

The CLI prompts for the vault password and masks each secret value. A successful
tab save updates the running BFF's vault-provenance cache immediately. The
feature requires both vault entries to be present before Run.

Optional non-secret controller setting:

```env
PRIVILEGE_USER_API_BASE_URL=https://privilege.test-one-pingone.com
```

The BFF reads the encrypted vault from `VAULT_PATH` or the project-root
`secrets.vault`. The controller URL defaults to the PDF's test host and is
never supplied by the browser.

## Verification plan

- BFF unit tests cover AES/OpenSSL-compatible format and round trip, nonce
  validation, vault-provenance reads (no environment/LMDB fallback), fixed-key
  vault writes, single-field replacement, failed-save atomicity, cache refresh,
  masked-value generation, fixed outbound URLs, and HTTP failures.
- BFF route tests cover administrator authentication/CSRF, vault password
  failures, no-op save rejection, redacted request/response/activity/API
  tracker data, UUID validation, each token-flow stage, and failure
  short-circuiting.
- UI tests cover tab title and placement, blank password inputs, one-field
  replacement, clearing after save, masked previews, redaction from traffic
  history/local storage, progress states, errors, and rendering the users
  response.
- Run the required UI build and focused checks for the touched BFF/UI surfaces.
- Read `REGRESSION_PLAN.md` sections 0–1 and run the repository's
  `regression-guard` before implementation because this changes an
  authorization/token-exchange surface and `demo_api_ui/`.
