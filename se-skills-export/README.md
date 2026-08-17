# SE Skills Export

Generic Claude Code skills extracted from this repo's `.claude/skills/`,
stripped of anything specific to the AI-DEMO2 banking demo. Meant to be
copy-pasted by any Ping SE into their own `~/.claude/skills/<name>/`
(personal, all repos) or a specific project's `.claude/skills/<name>/`.

These deliberately do NOT duplicate the official `ping-identity` Claude
Code plugin (marketplace `pingidentity`), which already covers broad
platform knowledge — tenant setup, app registration, DaVinci/AIC journeys,
SDK integration, universal services. Install that plugin first; the skills
here are narrower, tool-shaped things it doesn't provide: a working file
generator, IDE/MCP connection runbooks, and shared-infra deploy discipline.

## Skills

| Skill | What it does |
|---|---|
| [`p1az-import-generator/`](p1az-import-generator/) | Turns plain-language authorization rules into a PingOne Authorize (P1AZ) snapshot import file — P1AZ has no API for authoring policy logic, so this is the only non-console path |
| [`pingone-mcp-connect/`](pingone-mcp-connect/) | Connect an IDE (Claude Code / Cursor / VS Code) to PingOne's MCP server: install, create the right kind of Worker OAuth app, wire redirect URIs, fix the common auth failures |
| [`ping-se-cluster-deploy/`](ping-se-cluster-deploy/) | Get access to and deploy onto Ping's shared SE DevOps Kubernetes cluster: namespace request, kubeconfig, GHCR auth, undeploy etiquette |
| [`privilege-cloud-mcp-gateway/`](privilege-cloud-mcp-gateway/) | Durable lessons for troubleshooting a PingOne Privilege Cloud MCP gateway integration — this vendor API is young and still shifting, treat every specific (port, header) as something to verify live, not trust |
| [`karpathy-guidelines/`](karpathy-guidelines/) | General coding-agent behavior guidelines (not Ping-specific) — bonus, zero rework needed |

## Install

```bash
cp -r p1az-import-generator ~/.claude/skills/
cp -r pingone-mcp-connect ~/.claude/skills/
# ...etc, or copy the whole se-skills-export/ tree in one go
```

Or drop individual folders into a project's `.claude/skills/` to scope them
to that repo only.
