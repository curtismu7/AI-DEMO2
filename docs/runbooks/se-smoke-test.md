# SE smoke test: ID-JAG playground and Inspector

Run this after every deploy that touches `demo-api-server`, `frontend` or the PingFederates. It drives the real pages in a real browser and prints PASS or FAIL per check. Exit code 1 means at least one check failed.

It cannot sign in for you: the sign-in has MFA. You sign in once, the script does the rest.

## Run it

Easiest, the script opens a visible browser:

```
node scripts/se-smoke-playground.cjs
```

1. Sign in to the app: user menu, then Sign In (password, plus the verification code if asked).
2. In the playground, click **Sign in with PingFederate** in step 1 and finish it.
3. When step 1 says you are signed in, press Enter in the terminal.

Or attach to a browser you already signed in. Start Chrome with `--remote-debugging-port=9333`, sign in, then:

```
node scripts/se-smoke-playground.cjs --cdp http://127.0.0.1:9333
```

Options: `--base <url>` (default `https://ai-demo.ping-devops.com`), `--out <dir>` for screenshots, `--lanes oauth-mcp,pf-pf`, `--subjects OIDC,SAML`, `--skip-inspector`.

## What it checks

| Area | Check |
|---|---|
| App | the playground config API answers 200 (you are signed in) |
| Each lane (oauth-mcp, PF to PF) and subject (OIDC, SAML) | Request ID-JAG answers 200 and the page shows the lane's audience; Redeem answers 200 |
| Step 4, List tools | answers 200, or a 502 that does not raise the sign-in dialog or the words "session expired". On SE the MCP gateway validates PingOne tokens only, so with `ID_JAG_PLAYGROUND_STEP4_ENABLED=false` step 4 is a negative test: the button reads "Send this token to the gateway (expected: refused)" and the check passes when the page shows "Refused, as expected" (no sign-in dialog, no "session expired"). |
| Inspector | the Decode & check and Live log tabs (Discovery is not a tab); Backends starts collapsed; Get an ID-JAG gives 0 failed checks; the trusted-IdP row names the issuer; Show token reveals a 3-part token of type `oauth-id-jag+jwt`; Hide token clears it; Backends discovery loads |

It never prints tokens: only status codes, counts and the JWT header type.

## Reading a failure

- `signed in at PingFederate` fails: click **Sign in with PingFederate** in step 1 of that lane and run again.
- `Request ID-JAG` fails with 502: the page shows the PingFederate error. `invalid_target` means the SP connection or audience is missing, `server_error` on SAML usually means the SAML policy mapping is missing on that connection (`scripts/pingfederate/configure-saml-idjag.js`).
- The whole page shows `api_restarting`: the API pod is not scheduled yet. Run `scripts/se-capacity-check.sh`.
- Screenshots of every step are in the `--out` folder.

## Known limits

- It needs a person for the sign-in, so it cannot run unattended in CI.
- It covers the playground and the Inspector, not the rest of the demo.
