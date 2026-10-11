# Slack announcement — AI demo sharing

**Status: ready to post once access is granted (repo collaborators + package access).**
Written 2026-10-11. Verify both URLs are still healthy before posting:
`https://ai-demo.ping-devops.com` (shared demo) and the repo
`https://github.com/cmuir_pingcorp/AI-DEMO2`.

---

**🚀 The AI demo is open — try it**

**👉 Zero-install option:** open **https://ai-demo.ping-devops.com** and sign in with Ping SSO. The full stack is already running: banking agents, MCP gateways, RFC 8693 token exchange, LLM tool-calling, human-in-the-loop approvals, and the observability stack. Nothing to install — works from any browser.

**🛠 Want your own instance?** You can run the entire demo on the SE DevOps cluster in **your own namespace** (own URL, own state, no laptop hosting):

```bash
git clone https://github.com/cmuir_pingcorp/AI-DEMO2 && cd AI-DEMO2
gh auth login        # once — your Ping GitHub account
./run-pingaws.sh kubeconfig
./run-pingaws.sh start
```

~30 min first run; your demo lands at `https://<your-name>.ai-demo.ping-devops.com`. LLMs run in-cluster (models download automatically), images come from GHCR, and your namespace is fully isolated from the shared demo.

**Before you start, you need access:** ping me and I'll add you — the repo and images are access-controlled. Everything else is covered in the install guide (`docs/runbooks/install-ai-demo.pdf` in the repo).

Questions, demos, or want a walkthrough — ping me.

---

## For the maintainer (not part of the Slack post)

When someone pings for access, grant both:

1. **Repo** — read collaborator:
   `gh api -X PUT repos/cmuir_pingcorp/AI-DEMO2/collaborators/<their-username> -f permission=pull`
   (or Settings → Collaborators → Add people)
2. **Packages** — per-package, UI only (EMU blocks the API):
   https://github.com/cmuir_pingcorp?tab=packages → each package →
   ⚙ Package settings → Manage access → add their user → **Read**

Recipients then run the clone-and-go above. Their deploy creates its own
`ghcr-pull-secret` from their `gh` token automatically
(`k8s/aws/deploy.sh:190-209`), so no extra pull-secret step on their side.

If someone can't pull images despite repo access, the missing piece is the
package grant (#2) — user-owned packages don't inherit repo collaborator
access.

Longer term (needs an org owner): move the repo into `ping-internal` to get
org packages + team grants, removing the per-person maintenance.
