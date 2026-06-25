# Contents
- ## 🏛️ Architecture (current-state source of truth)
	- [[ARCHITECTURE]] — Full system overview: what the demo is (AI-agent security, not a bank), component map, the four planes, end-to-end flow.
	- [[SERVICE_TOPOLOGY]] — Every service, port & language; network topology; read-path vs write-path-with-HITL request flows; gateway tool routing.
	- [[SECURITY_ARCHITECTURE]] — OAuth + PKCE login, the two RFC 8693 token exchanges (`act`/`may_act`), the Authorize pipeline (PERMIT/DENY/STEP-UP/HITL), HITL consent, and scopes.
- ## 📋 Project
	- [[CLAUDE]] — Agent operating instructions for this repo.
	- [[REGRESSION_PLAN]] — Protected areas and the do-not-break contract.