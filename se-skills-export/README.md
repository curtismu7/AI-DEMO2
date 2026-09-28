# Ping Product Skill Packages

Each folder in this directory is an independently installable skill package containing `SKILL.md`. These packages are useful both with AI-DEMO2 and as starting points for other Ping product integrations. Project copies live under `.claude/skills/`; keep those copies synchronized when a skill changes.

## Packages

| Skill | Use it for |
|---|---|
| [`pingdirectory-ai-demo/`](pingdirectory-ai-demo/) | PingDirectory LDAP integration, schema, groups, TLS, and operations |
| [`pingaccess-ai-demo/`](pingaccess-ai-demo/) | PingAccess web/API enforcement and distinguishing it from PingGateway |
| [`pingid-ai-demo/`](pingid-ai-demo/) | PingID MFA integration, enrollment, and authentication policy |
| [`pingauthorize-aam-ai-demo/`](pingauthorize-aam-ai-demo/) | PingOne Authorize API Access Management, Sideband, API services, and the demo's AAM path |
| [`pingone-protect-ai-demo/`](pingone-protect-ai-demo/) | PingOne Protect and Signals risk-evaluation integration |
| [`p1az-import-generator/`](p1az-import-generator/) | Generate a PingOne Authorize policy snapshot from plain-language rules |
| [`pingone-mcp-connect/`](pingone-mcp-connect/) | Connect an IDE to PingOne MCP and configure its Worker app |
| [`ping-se-cluster-deploy/`](ping-se-cluster-deploy/) | Shared Ping SE Kubernetes cluster access and deployment |
| [`privilege-cloud-mcp-gateway/`](privilege-cloud-mcp-gateway/) | PingOne Privilege Cloud MCP gateway troubleshooting |
| [`karpathy-guidelines/`](karpathy-guidelines/) | General coding-agent behavior guidelines |

For a personal Claude Code installation:

```bash
cp -R <skill-name> ~/.claude/skills/
```

For project use, copy the folder to `.claude/skills/`. Other compatible agents may use their documented skill directory. Reload the agent if it does not discover the new skill.

Ping product behavior and APIs change by release and deployment. Each skill directs the agent to start from Ping's official documentation index (`https://docs.pingidentity.com/llms.txt`) and verify version-specific details before using them.
