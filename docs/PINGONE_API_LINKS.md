# PingOne API Documentation Links

> **Note:** The canonical Ping Identity API docs site moved from `apidocs.pingidentity.com` to `developer.pingidentity.com` in 2026. Old fragment-anchor URLs (`#post-…`) no longer work — each operation now has its own HTML page. All links below are verified against the live site.

---

## Base URL

```
https://developer.pingidentity.com/pingone-api/
```

Old base (redirects, but anchors are broken):

```
https://apidocs.pingidentity.com/pingone/platform/v1/api/  →  301 redirect
https://apidocs.pingidentity.com/pingone/workflow-library/v1/api/  →  301 redirect
```

---

## Top-Level Sections

| Section | URL |
|---------|-----|
| Introduction | https://developer.pingidentity.com/pingone-api/introduction.html |
| Changelog | https://developer.pingidentity.com/pingone-api/changelog.html |
| Before You Begin | https://developer.pingidentity.com/pingone-api/before-you-begin/introduction.html |
| Getting Started | https://developer.pingidentity.com/pingone-api/getting-started/introduction.html |
| Use Case Library | https://developer.pingidentity.com/pingone-api/workflow-library/introduction.html |
| Foundations | https://developer.pingidentity.com/pingone-api/foundations/introduction.html |
| Platform SSO APIs | https://developer.pingidentity.com/pingone-api/platform/introduction.html |
| Platform Auth APIs | https://developer.pingidentity.com/pingone-api/auth/introduction.html |
| PingOne Authorize | https://developer.pingidentity.com/pingone-api/authorize/introduction.html |
| PingOne Credentials | https://developer.pingidentity.com/pingone-api/credentials/introduction.html |
| PingOne DaVinci | https://developer.pingidentity.com/pingone-api/davinci/introduction.html |
| PingOne MFA | https://developer.pingidentity.com/pingone-api/mfa/introduction.html |
| PingOne Protect | https://developer.pingidentity.com/pingone-api/protect/introduction.html |
| PingOne Verify | https://developer.pingidentity.com/pingone-api/verify/introduction.html |

---

## Application Management

| Operation | Method | URL |
|-----------|--------|-----|
| Application Operations (index) | — | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1.html |
| Create Application (OIDC Web App) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---web-app.html |
| Create Application (OIDC Native App) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---native-app.html |
| Create Application (OIDC SPA) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---single-page-app.html |
| Create Application (OIDC Service App) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---service-app.html |
| Create Application (OIDC Worker App) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---worker-app.html |
| Create Application (SAML Protocol) | POST | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-saml-protocol.html |
| Read All Applications | GET | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/read-all-applications.html |
| Read One Application | GET | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/read-one-application.html |
| Delete Application | DELETE | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/delete-application.html |
| Application Attribute Mapping | — | https://developer.pingidentity.com/pingone-api/platform/applications/application-attribute-mapping.html |
| Application Resource Grants | — | https://developer.pingidentity.com/pingone-api/platform/applications/application-resource-grants.html |
| Application Role Assignments | — | https://developer.pingidentity.com/pingone-api/platform/applications/application-role-assignments.html |
| Application Secret | — | https://developer.pingidentity.com/pingone-api/platform/applications/application-secret.html |

---

## PingOne MFA — Device Management

### MFA Devices (enrollment / activation)

| Operation | Method | URL |
|-----------|--------|-----|
| MFA Devices (index) | — | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices.html |
| Create MFA User Device (SMS) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-sms.html |
| Create MFA User Device (Email) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-email.html |
| Create MFA User Device (Voice) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-voice.html |
| Create MFA User Device (TOTP) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-totp-.html |
| Create MFA User Device (FIDO2) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/fido2-biometrics-devices/create-mfa-user-device-fido2---security_key.html |
| Create MFA User Device (OATH Token) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create_mfa_user_device_oath_token.html |
| Activate MFA User Device | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/activate-mfa-user-device.html |
| Activate MFA User Device (FIDO2) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/fido2-biometrics-devices/activate-mfa-user-device-fido2.html |
| Activate MFA User Device (OATH Token) | POST | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/activate_device_oath_token.html |
| Read All MFA User Devices | GET | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/read-all-mfa-user-devices.html |
| Read One MFA User Device | GET | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/read-one-mfa-user-device.html |
| Delete MFA User Device | DELETE | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/delete-mfa-user-device.html |

### MFA Device Authentications (OTP / challenge flows)

| Operation | Method | URL |
|-----------|--------|-----|
| MFA Device Authentications (index) | — | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications.html |
| Initialize Device Authentication | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/initialize-device-authentication.html |
| Device Authentication — One-time SMS | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-sms.html |
| Device Authentication — One-time Voice | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-voice.html |
| Device Authentication — One-time Email | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-email.html |
| Validate OTP for Device | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/validate-otp-device-authentication.html |
| Check Assertion (FIDO2 Device) | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/check-assertion-device-authentication.html |
| Select Device for Authentication | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/select-device-authentication.html |
| Cancel Device Authentication | POST | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/cancel_authentication.html |
| Read Device Authentication | GET | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/read-device-authentication.html |

### Other MFA Resources

| Resource | URL |
|----------|-----|
| Enable Users MFA | https://developer.pingidentity.com/pingone-api/mfa/users/enable-users-mfa.html |
| MFA Pairing Keys | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-pairing-keys.html |
| MFA Authentication Code | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-authentication-code.html |
| Device Authentication Policies | https://developer.pingidentity.com/pingone-api/mfa/device-authentication-policy.html |
| MFA Settings | https://developer.pingidentity.com/pingone-api/mfa/mfa-settings.html |
| FIDO Policies | https://developer.pingidentity.com/pingone-api/mfa/fido-policies.html |
| OATH Tokens | https://developer.pingidentity.com/pingone-api/mfa/oath-tokens.html |

---

## Old → New URL Mapping (migration reference)

| Old anchor (broken) | New URL |
|---------------------|---------|
| `…/api/#post-create-device-sms` | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-sms.html |
| `…/api/#post-create-device-email` | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-email.html |
| `…/api/#post-activate-device` (SMS/Email) | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/activate-mfa-user-device.html |
| `…/api/#post-activate-device` (FIDO2) | https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/fido2-biometrics-devices/activate-mfa-user-device-fido2.html |
| `…/api/#post-send-otp-sms-email` (SMS) | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-sms.html |
| `…/api/#post-send-otp-sms-email` (Email) | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/onetime-authentication-email.html |
| `…/api/#post-check-otp` | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/validate-otp-device-authentication.html |
| `…/api/#post-authenticate-with-fido2` (initiate) | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/initialize-device-authentication.html |
| `…/api/#post-authenticate-with-fido2` (verify) | https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/check-assertion-device-authentication.html |
| `…/api/#post-create-application` | https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---web-app.html |

---

## Related OIDC / OAuth Specifications

| Spec | URL |
|------|-----|
| RFC 6749 — OAuth 2.0 Authorization Framework | https://www.rfc-editor.org/rfc/rfc6749 |
| RFC 6750 — Bearer Token Usage | https://www.rfc-editor.org/rfc/rfc6750 |
| RFC 7009 — Token Revocation | https://www.rfc-editor.org/rfc/rfc7009 |
| RFC 7519 — JSON Web Token (JWT) | https://www.rfc-editor.org/rfc/rfc7519 |
| RFC 7521 — Assertion Framework for OAuth 2.0 | https://www.rfc-editor.org/rfc/rfc7521 |
| RFC 7591 — OAuth 2.0 Dynamic Client Registration | https://www.rfc-editor.org/rfc/rfc7591 |
| RFC 7636 — PKCE (Proof Key for Code Exchange) | https://www.rfc-editor.org/rfc/rfc7636 |
| RFC 7662 — Token Introspection | https://www.rfc-editor.org/rfc/rfc7662 |
| RFC 8693 — Token Exchange | https://www.rfc-editor.org/rfc/rfc8693 |
| RFC 8707 — Resource Indicators | https://www.rfc-editor.org/rfc/rfc8707 |
| RFC 9068 — JWT Profile for Access Tokens | https://www.rfc-editor.org/rfc/rfc9068 |
| RFC 9126 — Pushed Authorization Requests (PAR) | https://www.rfc-editor.org/rfc/rfc9126 |
| RFC 9728 — OAuth 2.0 Protected Resource Metadata | https://www.rfc-editor.org/rfc/rfc9728 |
| OpenID Connect Core 1.0 | https://openid.net/specs/openid-connect-core-1_0.html |
| OpenID Connect Discovery 1.0 | https://openid.net/specs/openid-connect-discovery-1_0.html |
| OpenID Connect Dynamic Client Registration 1.0 | https://openid.net/specs/openid-connect-registration-1_0.html |
| FIDO2 / WebAuthn W3C Spec | https://www.w3.org/TR/webauthn-3/ |
| FIDO2 CTAP2 Spec | https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html |
| draft-ietf-oauth-client-id-metadata-document (CIMD) | https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/ |
| draft-ietf-oauth-security-topics | https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics |
