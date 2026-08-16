# SE Skills Catalog Submissions

Draft entries for the Ping SE skills catalog (script.google.com form), matching
the existing "PingAuthorize" card format. Source skills live in
`se-skills-export/` on `main` in AI-DEMO2 (PR #1871).

---

**PingAuthorize**
PingOne Authorize (P1AZ) — Policy Import Generator
Generate a PingOne Authorize snapshot import file from plain-language authorization rules.
When to use: Use when you need a policy/rule file to import into PingOne Authorize's console and don't want to hand-build the snapshot JSON schema. Covers attribute/condition/statement/rule/policy structure, safe-default attribute values, and the common "forgot the catch-all rule → INDETERMINATE" mistake. Essential since P1AZ has no API for authoring policy logic — console import is the only path.
PingOne Authorize · Policy Import · Snapshot JSON · Admin Console · P1AZ
View in Drive → [placeholder]

---

**PingOne MCP**
PingOne MCP — IDE Connect & Worker App Setup
Connect Claude Code, Cursor, or VS Code to PingOne's MCP server and create the Worker OAuth app it needs.
When to use: Use when installing/fixing PingOne MCP in an IDE, creating a Worker OAuth client for interactive MCP login, or resolving net::ERR_FAILED, "At least one scope must be granted," ACCESS_FAILED, or a suspiciously small tool count after auth. Covers both the local stdio binary path and the hosted Remote MCP HTTP path.
PingOne MCP · IDE Integration · OAuth · Worker App · Claude Code · Cursor · VS Code
View in Drive → [placeholder]

---

**PingOne Privilege**
PingOne Privilege Cloud — MCP Gateway Troubleshooting
Methodology for setting up and debugging a Privilege Cloud MCP gateway integration (proxy fronting your own backend MCP server).
When to use: Use when your app needs to go through a Privilege Cloud MCP gateway to reach a backend MCP server — figuring out the correct front-door port, diagnosing a bare 401 with no WWW-Authenticate header, enrollment-token env-file formatting, or Host-based routing for a self-hosted frontend. Written to be probe-first: treat every port/header number as something to verify live, since the vendor binary and its behavior have changed under active use.
PingOne Privilege · MCP Gateway · Troubleshooting · Agentic AI
View in Drive → [placeholder]

---

**SE DevOps**
Ping SE DevOps Cluster — Access & Deploy
Get access to and deploy a demo/POC onto Ping's shared SE DevOps Kubernetes cluster.
When to use: Use for first-time cluster access (DEVHELP namespace request, kubeconfig, kubelogin/kubectx setup), the GHCR push + deploy routine, or the mandatory undeploy step since the cluster is shared across SEs.
Kubernetes · SE Cluster · DevOps · GHCR · Deployment
View in Drive → [placeholder]

---

## Not submitted

`karpathy-guidelines` — generic coding-agent behavior, not a PingOne product
skill. Doesn't fit this catalog's category scheme. Include only if the form
has a general/misc category.
