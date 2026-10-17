# CIBA handoff (PingOne + DaVinci), 2026-10-17

Real CIBA step-up approval, by **email link** or **text-message link**, through PingOne CIBA and DaVinci.
Supersedes the setup notes in `docs/ciba-real-provisioning-todo.md` where they differ.

## How it works

1. The BFF `POST /as/cibaAuthorization` to PingOne, authenticating as a CIBA app (client secret basic). PingOne returns `auth_req_id` (120 s lifetime, 2 s poll interval).
2. PingOne launches the **DaVinci flow policy assigned to that app** (flow trigger type `AUTHENTICATION`, subtype `CIBA`). It looks the user up, sends a notification with a magic link, and returns `userId` to PingOne.
3. The user opens the link, sees the consent page, and approves. The flow's `returnCibaSuccess` node completes the request at PingOne.
4. The BFF polls `/as/token` with the `auth_req_id`. On success it validates the ID token (audience = that channel's app, **subject = the signed-in user**), then marks step-up satisfied for the exact transaction that was bound to the request. Nothing redirects back to the app.

Verify from the PingOne audit log, not from the app: `GET /v1/environments/{env}/activities?filter=recordedat ge "<iso>"`. Look for `CIBA_AUTHENTICATION.SUCCEEDED` or `.FAILED` (details are under `_embedded.cibaAuthentication.error`) and the `NOTIFICATION.*` events.

## One app, flow and policy per channel

PingOne's CIBA request has no channel field, so each channel is its own app. Environment `01d89b06-66d5-430e-9f28-65636843788b`.

| | Email | Text (SMS) |
|---|---|---|
| App | `Demo AI App - CIBA Step-Up` `7d723ec0-e37c-4f18-a60f-5ce0c8bbdeeb` | `Demo AI App - CIBA Step-Up SMS` `4274debd-aef8-4a15-a532-136ef5caaf92` |
| Flow policy | `CIBA - EMAIL` `99972880d9170ab70d72e269cc944186` | `CIBA-SMS` `87929b3e4c6857e5ff854502dbde1742` |
| Flow | `CIBA flow - email only` `4597119f17ad658a655d582f110c870c` | `CIBA flow - SMS only` `6e7556ee3a831153d588bde652ca4c68` |
| Env vars | `PINGONE_CIBA_CLIENT_ID` / `_SECRET` | `PINGONE_CIBA_SMS_CLIENT_ID` / `_SECRET` |

Other settings: `CIBA_ENABLED=true`, `CIBA_TOKEN_DELIVERY_MODE=poll` (PingOne supports poll only), `CIBA_LOCAL_SIMULATION=false` (when true, a failed real request silently falls back to a mock phone).
Notification policy `603ecc50-8c1a-4ce9-849d-b14dc95bd403`; two **General** templates named `CIBA with binding message` and `CIBA without binding message`, each with Email and SMS content.
Flow files for import are generated from the original sample export; both flows use the lookup `(id eq "<hint>") or (username eq "<hint>")`.

## Code map

- `demo_api_server/services/cibaService.js`: channel-aware credentials (`availableChannels()`), binding message clamp, no `acr_values` forwarding.
- `demo_api_server/routes/ciba.js`: `/status` (lists `channels`), `/initiate` (`channel`, default hint), `/poll/:id` (ID token validation), simulator fallback (logs the real error).
- UI: `OtpStepUpModal.js` (picker rows), `AIAgent.js` (`startCibaStepUp`), `UserDashboardPing2026.js` (`lastMoneyMovementRef`), `MFATestCibaSection.tsx` + `MFATestPage.tsx` (one card per channel), `CIBAPanel.js`.
- Use cases: UC22 `ciba-out-of-band-approval` (chips `bk-ciba`, `wf-ciba`, `inv-ciba`).

## Traps we hit (each looked like something else)

- **`binding_message` max 8 characters** (`invalid_binding_message`). The service swaps anything longer for a 6-char code; the full text goes in `approval_summary`.
- **`acr_values` is read as a DaVinci policy ID.** Sending `Multi_Factor` returns 400 and the app silently fell back to the mock. It is no longer forwarded. The ID token's `acr` is the policy ID, so the poll must not compare it with a client ACR.
- **Initiation response `userId` claim was empty** (`global.authentication.userId`): PingOne 500 on initiate, then "invalid or expired" on approve. The claim must be Find user's `matchedUser.id`.
- **Approvals are bound to the transaction** (commit `2ed20dd1b`). A CIBA call without type, amount and accounts never sets `stepUpVerified`, so the retry is challenged again, in a loop.
- **The email is not a unique login hint.** `demoUser` and `cmuir+demo-user@pingone.com` share it. The default hint is now the signed-in user's PingOne ID, which the poll's subject check compares.
- **DaVinci editor traps:** a hand-typed variable becomes literal text (`inputCibaUser`); stray `[ ]` and missing quotes break the SCIM filter; an editor tab opened before an API edit saves its old copy over it, so reload before deploying. App names cannot contain parentheses.
- **Phone must be the profile's Mobile phone**, not an MFA device. A placeholder number is accepted and then rejected by the carrier.
- **"Always" conditions** on the template-choice node sent both emails (and both SMS paths).
- Real approval needs `expires_in` 120 s: click quickly.

## Operating notes

- The DaVinci admin API works with the worker credentials: `GET`/`PUT api.pingone.com/v1/environments/{env}/flows/{id}`. A `PUT` saves a **draft**; someone must click Deploy. Back up first.
- Hosted site (`ai-demo.ping-devops.com`): config lives in `ai-demo-secrets` / `ai-demo-config`. The API server has two single-attach volumes, so a restart waits about two minutes (Multi-Attach warnings are normal). Merging does not deploy; images are built by CI and rolled with `kubectl set image`.
- Hosted API pod log shows `[CIBA] ... configured` at startup and `[CIBA] invalid identity result: <reason>` on a rejected approval.

## State at handoff

Merged: #1420, #1430, #1439, #1445, #1448, #1449. Open: **#1453** (login hint = PingOne ID, "sent" banner, clearer errors). Live on hosted: both CIBA apps' credentials set, simulation off, picker rows, styled test cards.

Rollout order for #1453: deploy both flows (draft v2 saved with the id-or-username filter), then merge, then roll hosted API server and frontend.

## Not done

- Confirm on hosted: email and text cards approve end to end with the right account; UC22 transfer, picker rows and the three chips.
- Remove the dangling `38535bc2` assignment on the email app; delete the unused `CIBA sample flow (email + SMS)` (`a382f05a…`).
- A user with no phone on the SMS-only flow ends in the "no mobile phone" error screen; untested.
- Two inline CIBA branches in `AIAgent.js` still do not use `startCibaStepUp`.
- Learning Hub `ciba-oob.html` and the CIBA diagrams still describe a phone push, not email and text links.
