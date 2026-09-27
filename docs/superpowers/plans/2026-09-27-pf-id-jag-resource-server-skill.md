# PingFederate ID-JAG Resource Server Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add one repository-local skill and a complete mirrored copy in `~/Documents` that guide end-to-end PF ID-JAG redemption and downstream access-token validation.

**Architecture:** Keep one concise skill entrypoint and split the detailed trust checks into two references: the `oauth-mcp` authorization-server grant and downstream gateway/resource-server validation. Put usage instructions in the README and mirror all four files to the user's Documents folder.

**Tech Stack:** Markdown skill files, repository-local Claude skills, shell file-copy and diff tools.

**Spec:** [2026-09-27-pf-id-jag-resource-server-skill-design.md](../specs/2026-09-27-pf-id-jag-resource-server-skill-design.md)

## Global Constraints

- Keep the canonical skill under `.claude/skills/creating-pingfederate-id-jag-resource-server/`.
- Keep an identical four-file copy at `/Users/cmuir/Documents/creating-pingfederate-id-jag-resource-server/`.
- Treat the raw ID-JAG as a grant assertion for `oauth-mcp`, not as a resource-server bearer token.
- Preserve the distinct issuers, JWKS sources, accepted audiences, and scopes at each hop.
- Make no service-code or runtime configuration changes and do not mutate live PingFederate state.
- Do not run automated tests for this documentation-only task; inspect the written content and verify the copy matches the source.

---

### Task 1: Deliver the complete skill bundle

**Files:**
- Create: `.claude/skills/creating-pingfederate-id-jag-resource-server/SKILL.md`
- Create: `.claude/skills/creating-pingfederate-id-jag-resource-server/README.md`
- Create: `.claude/skills/creating-pingfederate-id-jag-resource-server/references/id-jag-redemption.md`
- Create: `.claude/skills/creating-pingfederate-id-jag-resource-server/references/downstream-validation.md`
- Create: `/Users/cmuir/Documents/creating-pingfederate-id-jag-resource-server/` (identical four-file copy)

- [ ] Write `SKILL.md` with the approved name/trigger, end-to-end workflow, and conditional links to the two layer references.
- [ ] Write `references/id-jag-redemption.md` around `oauth-mcp/src/oauth/IdJagGrantHandler.ts`, `OAuthRouter.ts`, and the existing ID-JAG unit suites. Cover `typ`, pinned algorithm, issuer/audience, timestamps, accepted resource, `jti` replay, and the process-local replay-cache limitation.
- [ ] Write `references/downstream-validation.md` around `demo_mcp_gateway/src/tokenValidator.ts`, `GatewayTokenPolicy.ts`, `demo_mcp_resource_server/src/server/tokenValidator.ts`, and their focused ID-JAG/PF tests. Explain the current issuer/JWKS behavior at each hop and the gateway-mediated exchange path.
- [ ] In both references, call out exact issuer-string alignment, the different `MCP_SERVER_RESOURCE_URI` and `MCP_RESOURCE_SERVER_RESOURCE_URI` settings, BFF-only token custody, fail-closed checks, and no mock fallback.
- [ ] Write `README.md` with when to use the skill, the Claude Code slash invocation, and an example request that supplies target resource URI, audience, scopes, and whether live PF provisioning is requested.
- [ ] Copy the complete repository skill directory, including `references/`, to `/Users/cmuir/Documents/creating-pingfederate-id-jag-resource-server/` and compare the two trees recursively; expected result is no content differences and exactly four files in each.
- [ ] Check the bundle against the spec, especially that the raw ID-JAG never reaches a resource server and that the gateway and backend do not assume the same issuer/JWKS.
- [ ] Run `git diff --check`, inspect the staged path list, stage only the four repository skill files, confirm branch `codex/pf-id-jag-resource-server-skill`, and commit the skill bundle as one logical unit.
