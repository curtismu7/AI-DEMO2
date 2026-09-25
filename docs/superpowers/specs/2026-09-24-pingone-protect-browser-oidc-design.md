# PingOne Protect standalone browser evaluation

## Goal

Provide a dedicated Ping products page that runs the PingOne Signals Web SDK in
the browser, sends its payload to the BFF, and displays the sanitized risk
response returned by PingOne Protect. This is an evaluation viewer: it does not
start OIDC, request MFA, block sign-in, or dispatch an agent action.

## Flow and boundaries

1. The user enters the username or email to evaluate and starts a run.
2. The browser loads and initializes PingOne Signals, then collects fresh browser
   signals for that run. The raw payload is never shown or placed in the URL.
3. The browser sends the user identifier and Signals payload to the BFF.
4. The BFF derives IP and user agent, uses its server-side Worker token to call
   PingOne Protect, and returns only risk level, recommended action, and the
   available bot-detection summary. Worker credentials and evaluation IDs stay
   server-side.
5. The page renders the response. Low, Medium, and High are displayed as
   provider results; the page does not apply an authentication or agent policy.

The page supports the normal app shell and a pop-out view, with the shared light
and dark theme control. It is linked under **Ping products**. The previous UC36
agent-dispatch path and its feature flag are removed because Protect risk
evaluation belongs on this standalone browser page in this demo.

## Configuration and failure behavior

Reuse the configured PingOne environment, region, and SDK demo client as the
evaluation target. The BFF validates the identifier and Signals payload size,
and fails with a clear API error if configuration, Signals collection, or the
Protect API call fails. Do not return raw Signals, Worker credentials, or the
Protect evaluation ID to the browser.

## Verification

- UI tests cover Signals collection, request submission, sanitized response
  rendering, errors, pop-out, and theme control.
- BFF tests cover server-derived context, payload validation, response
  sanitization, and Protect API request construction.
- Keep ordinary SDK OIDC login/callback behavior independent of this page.
- Build the UI after changes to `demo_api_ui/`.

## Documentation references

- [PingOne Protect risk predictors](https://docs.pingidentity.com/pingone/threat_protection_using_pingone_protect/p1_protect_risk_predictors.html)
- [PingOne Signals SDK for Web](https://developer.pingidentity.com/pingone-api/native-sdks/pingone-risk-sdks/risk_evaluation_sdk_web.html)
