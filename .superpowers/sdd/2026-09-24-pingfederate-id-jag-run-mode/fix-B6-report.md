# B6 fix report — PingOne selected during live ID-JAG launch

The shared UI launch handler now reads the effective OAuth provider from the
public masked configuration before posting an ID-JAG intent or starting logout.
With PingOne selected, it clears the pending client intent, leaves the current
session and URL in place, and gives the presenter a recovery message. The demo
page also renders an alert when the server returns
`error=id_jag_provider_required` after sign-out, including the P1/PF switch
instruction and an admin sign-in link. The page replaces its live status with
that alert if the preflight fails while it is open.

Scope: `useAuth.js`, `EnterpriseMcpDemoPage.jsx`/`.css`, their focused tests,
and the B6 entry in `REGRESSION_PLAN.md`. No agent callback/trace, Compose,
OAuth middleware, or authorization configuration was changed.

Verification:

- Red phase: the two focused tests failed on the missing provider check and
  missing page alert. A third page test was added for the in-page preflight
  message.
- Green phase: `npx vitest run src/pages/__tests__/EnterpriseMcpDemoPage.test.jsx src/hooks/__tests__/useAuth.idJagReset.test.jsx` — 2 files, 13 tests passed, exit 0.
- `npm run build` in `demo_api_ui` — exit 0. Vite reported absent development
  TLS files and a large chunk warning; neither failed the build.
- Full UI suite and live browser login were outside this focused B6 check.

The other final-review blockers remain outside this fix.
