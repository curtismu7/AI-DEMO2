# Task 1 report
Status DONE_WITH_CONCERNS. Commit 288112a4b. Decision: provisional R1.
Full evidence and costs: docs/superpowers/specs/2026-10-17-ciba-login-spike-result.md.
Proven: CIBA accepts CLIENT_SECRET_POST (200 + NOTIFICATION.CREATED); Basic on a secret-post app is 401; acr_values selects email vs SMS policy only if both are assigned to the app (else 400 Invalid DV Flow Policy ID); CIBA step-up apps have no resource grants; role derivation reuses callback logic.
Not proven (needs one approval): token aud/scope, refresh token, population in userinfo, R2 exchange. Request SP4821 sent 18:44:01Z, expired unapproved.
Throwaway app to delete: SPIKE-delete-me-ciba-login-mvcqviop, id 217bb022-6b18-48a6-b8a6-5d939432943c. Nothing blocked by the harness.
