---
name: pingid-ai-demo
description: Use when adding or troubleshooting PingID multi-factor authentication, device enrollment, authentication policy, user experience, or PingID integration with an identity provider.
---

# PingID integration

PingID and PingOne MFA are distinct products. AI-DEMO2 currently has PingOne MFA device-management and step-up flows; those APIs, policies, and credentials are not interchangeable with PingID.

## Workflow

1. Start at `https://docs.pingidentity.com/llms.txt`, follow the PingID and PingID User Guide docsets, and confirm the customer deployment and release. Verify supported factors, adapters, endpoints, and enrollment requirements for that exact deployment.
2. Locate the authentication owner (for example, PingFederate or PingOne) and define where PingID runs in the flow. Document enrollment, challenge, successful assertion, cancellation/timeout, recovery, and account/device lifecycle before changing an integration.
3. Identify the authoritative user/device identifier and factor policy. Ensure recovery and fallback methods meet the same intended assurance level; do not silently downgrade to an easier factor after an error.
4. Keep service credentials and enrollment secrets server-side. Validate callback/response state, bind results to the initiating transaction and user, and avoid logging OTPs, push payloads, tokens, or device secrets.
5. Test first-time enrollment, already-enrolled users, approval/denial, timeout, device loss/recovery, duplicate callback/replay, and upstream outages. Show that a failed or missing factor cannot continue a protected action.
6. Provision or change real users, policies, or devices only when explicitly requested; read the exact operation/script first and verify the target tenant.

## AI-DEMO2 boundary

For existing device lifecycle behavior, use the PingOne MFA skill under `pingone/pingone-mfa/`. For login/step-up and OAuth session behavior, inspect the owning BFF and regression guidance. If adding PingID, create a separate adapter and configuration surface rather than relabeling PingOne MFA calls.
