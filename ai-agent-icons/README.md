# PingOne App Icons

Source artwork for this tenant's PingOne applications. Started 2026-08-22 with
the 12 `AI_AGENT`-type apps from the Investment Advisor / A2A specialist
migration; grew 2026-08-23 to cover every other demo-authored app that was
carrying the generic Ping logo. Uploaded to PingOne via the Create Image
endpoint and attached to each application's `icon` field — kept here so the
originals aren't only reachable through PingOne's opaque image storage.

Icons are grouped by what the app *does*, not given one bespoke design each —
several apps share a file where they share a function (e.g. every MCP-facing
app reuses the same door glyph). Standing convention: **every new PingOne app
gets a distinct icon** — never leave it on the default Ping logo. See
[[feedback-p1-app-needs-new-icon]] in project memory.

Deliberately left on the generic Ping logo: `PingOne DaVinci Connection`
(platform-managed connector, not demo-authored) and two `20260708-*`
timestamped ephemeral workers from a scripted skill run (throwaway, not worth
branding). `PingOneAgent_agent` / `PingOneDaVinciAgent_agent` / `PingOne Helix
Connection` are also unbranded for now — conceptually AI-agent identities, but
PingOne's application `type` is immutable post-creation (confirmed via a live
`PUT` test, rejected with `"Property 'type' is immutable"`), so they can't
actually become `AI_AGENT`-typed without a full delete/recreate.

| File | PingOne application(s) |
|---|---|
| `01-super-banking-ai-agent.png` | Demo AI App - AI Agent Actor (root, Two-Exchange Step 1) |
| `02-investment-advisor.png` | Demo AI App - Investment Advisor Agent |
| `03-records-specialist.png` | Demo AI App - Records Specialist Agent |
| `04-purchase-specialist.png` | Demo AI App - Purchase Specialist Agent |
| `05-membership-specialist.png` | Demo AI App - Membership Specialist Agent |
| `06-payroll-specialist.png` | Demo AI App - Payroll Specialist Agent |
| `07-tax-records-specialist.png` | Demo AI App - Tax Records Specialist Agent |
| `08-financial-aid-specialist.png` | Demo AI App - Financial Aid Specialist Agent |
| `09-supplier-contract-specialist.png` | Demo AI App - Supplier Contract Specialist Agent |
| `10-holdings-specialist.png` | Demo AI App - Holdings Specialist Agent |
| `11-passenger-records-specialist.png` | Demo AI App - Passenger Records Specialist Agent |
| `12-identity-verification-specialist.png` | Demo AI App - Identity Verification Specialist Agent |
| `15-mcp-external-client.png` | Demo AI App - MCP External Client, Demo AI App - MCP Gateway, Privilege Cloud MCP Gateway, PingOne MCP Server, PingOne MCP Server - Claude Code Worker |
| `16-token-exchange.png` | Demo AI App - Token Exchanger, Demo AI App - MCP Step 9 Exchanger |
| `17-introspection.png` | Demo AI App - Introspection Worker |
| `18-admin-login.png` | Demo AI App - Admin Login |
| `19-user-login.png` | Demo AI App - User Login |
| `20-pkce.png` | Demo AI App - PKCE |
| `21-claude-code-client.png` | Claude Code - Banking Gateway |
| `22-privilege.png` | PingOne Privilege |

13 and 14 are uploaded to PingOne (Demo AI App - Agent Actor, Demo AI App - MCP
Server Client) but their source files were never committed here — numbering
skips them rather than reusing the slots.
