# CIMD client documents for PingOne Privilege

- **Date:** 2026-10-07
- **Status:** built and deployed to the SE host. Privilege has not yet been shown to accept our own documents (see "What is verified").
- **Related:** AI-DEMO2 PR #997 (`f94ca9124`) and PR #1000 (`9686a37`); `demo_api_server/routes/cimdAgentMetadata.js`

## The short version

- **CIMD** (Client ID Metadata Document) lets an AI client identify itself to an authorization server with a **web address instead of a registration**. The client's `client_id` is an https URL. The server fetches that URL and reads a small JSON file describing the client.
- PingOne Privilege now has a **MCP Client Documents** setting that works this way. Privilege keeps a list of document URLs it will accept, and it fetches each one itself.
- We built the other half: **our agents now publish those documents**, at public URLs on `ai-demo.ping-devops.com`, so they can be added to that list.
- The result is that each of our agents can be a **named, allow-listed client** in Privilege, with no client secret and no open self-registration.
- What is proven today: our documents are live and publicly fetchable, and Privilege is known to fetch and read a real public document (Claude's). What is **not** yet proven: Privilege accepting *our* documents and completing a sign-in with them.

## The problem this solves

An AI client such as an agent, Claude or ChatGPT has to be *known* to the authorization server before it can ask a user to sign in. There are three ways that can happen.

| Approach | How it works | Weakness |
|---|---|---|
| Pre-registration | An admin creates the client by hand and shares an id and secret. | Does not scale to clients you do not control. Secrets to store and rotate. |
| Dynamic client registration (DCR, RFC 7591) | The client calls a `/register` endpoint and is given a `client_id`. | If registration is open, anyone can register, and every registration is a new record with no tie to who the client really is. Our Privilege notes record the gateway's own DCR registry as open. |
| **CIMD** | The client's `client_id` **is** a URL. The server fetches the URL to learn the client's name and redirect addresses. | The server must be able to fetch the URL, and must decide which URLs to trust. |

CIMD ties a client's identity to something its owner controls: a web address. Anyone can still *host* a document, so the server's list of accepted URLs is what makes it safe. That list is the Privilege setting this work feeds.

## What a client document is

It is a small JSON file. This is what our `langchain-agent` serves:

```json
{
  "client_id": "https://ai-demo.ping-devops.com/api/cimd/privilege/langchain-agent/client-metadata.json",
  "client_name": "LangChain Banking Agent",
  "redirect_uris": ["https://ai-demo.ping-devops.com/api/external-agents/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Two rules matter:

1. **The document must name its own URL.** `client_id` has to equal the URL it was fetched from. A client cannot claim someone else's document.
2. **It declares the redirect addresses and nothing more.** The Privilege tab says the same: listing a URL lets that URL's owner declare its redirect addresses and nothing else.

`token_endpoint_auth_method: none` means a **public client**. There is no secret to leak, rotate or store. Proof of the sign-in comes from PKCE instead.

## What the Privilege setting does

On the Privilege console, Settings, **MCP Client Documents**:

- **Document URL**: the client's metadata URL.
- **Type**: Public documents are fetched centrally by Privilege. Private ones are fetched by the gateway and cached.
- **Status**: shows whether the document was fetched and what it contained.
- **Gateway cache (hours)**: how long a gateway keeps a private document before refetching. Blank means 24.
- **Empty list means the feature is off.** Clients that do not use it register dynamically as before, and are not affected.

## How a sign-in works

![Sequence: client, Privilege, document host](2026-10-07-cimd-privilege-flow.png)

Only step 3 has been seen in the console, and that was with Claude's own document. Steps 1, 2 and 4 to 6 are what the CIMD design implies, and we have not yet run them with our documents.

## What we built

A public route in the demo's API server (the BFF):

```
GET /api/cimd/privilege/<slug>/client-metadata.json
```

It covers 17 clients: the 15 agents in the scope topology, plus `langchain-agent` and `demo-agent-service`. The document is built on request, from the topology for the 15 agents and from a small table for the other two.

Choices we made, which you may want to revisit:

- **Redirect URI:** each document points at the BFF's existing callback, `<serving origin>/api/external-agents/callback`. That is our choice, not something Privilege told us. The repo has no source for what Privilege expects.
- **Grants:** `authorization_code` and `refresh_token`, because that is the shape of Claude's document.
- **The older CIMD routes are untouched.** `/api/cimd/agents/...` serves the demo's mock authorization server and uses `client_credentials`. It is a different thing.

## Making it reachable

Privilege fetches anonymously. `ai-demo.ping-devops.com` is locked down, and every request is redirected to PingOne sign-in unless its path is on a short exception list. Without an exception, Privilege would have received a 302 instead of the document.

![Which paths are public and which are gated](2026-10-07-cimd-privilege-boundary.png)

What we opened is deliberately small:

- **17 exact paths**, GET only. Not a prefix, so a future slug is not public by accident.
- **No secrets** in the documents: a name, grant types and a redirect address.
- **Rate limited**, as the other public paths on that ingress are (5 requests per second, with a burst multiplier of 3).
- Anything else still gets the 302. We checked this against the live host.

## What it does for us

1. **Named, stable agent identities in Privilege.** Each agent has one URL that is its identity, instead of anonymous registrations that pile up.
2. **Admin control.** Privilege only accepts URLs on its list, so an admin decides which agents are recognised.
3. **No client secrets.** Public clients with PKCE mean nothing to rotate or leak.
4. **The same mechanism real MCP clients use.** Claude publishes a document at `https://claude.ai/oauth/mcp-oauth-client-metadata`, and Privilege fetched and read it. Our deployment notes record that clients such as ChatGPT, Claude and LM Studio rely on dynamic registration or a client document. Our agents now identify the way those clients do.
5. **Self-describing and cheap to extend.** Adding an agent is one entry in the route plus the three path lists (see the appendix).
6. **A clear demo story** for Privilege conversations: an agent is recognised by a URL its owner controls, and the gateway admin allow-lists it.

## What is verified

| Check | Result |
|---|---|
| Privilege fetches and reads a real public document (Claude's) | Yes. Status "Fetched", name and redirect count shown. |
| Privilege reports a missing document clearly | Yes. A wrong URL gave "404 Not Found". |
| Our documents are served locally and on the SE host | Yes. 200, `application/json`, `client_id` equals the fetched URL. |
| Anonymous access is limited to the 17 paths | Yes. An unlisted slug and `/api/cimd/agents` return 302. |
| Tests | Route and gate tests pass (42 of 42 in the scoped run), and CI was green on both PRs. |
| **Privilege accepts one of our documents** | **Not yet tested.** |
| **Privilege accepts our redirect URI and completes a sign-in** | **Not yet tested.** |

## What we did not do

- **We did not change the MCP servers.** `oauth-mcp` already accepts client documents, behind `MCP_OPEN_CLIENT_REGISTRATION` and an allowlist of hosts (`CIMD_ALLOWED_HOSTS`). `demo_mcp_gateway` deliberately does not. `demo_mcp_resource_server` and `demo_mcp_proxy` have no authorization server, so the idea does not apply to them. A client document describes a *client*, and none of the four is one.
- **We did not publish documents for the MCP servers themselves**, for the same reason.

## Open questions and risks

- **Redirect URI is a guess.** If Privilege rejects it, the fix is one line in the route.
- **Server-side agents may not fit.** `langchain-agent` and `demo-agent-service` authenticate with client credentials and token exchange, not an interactive browser sign-in. A document that describes an `authorization_code` client may be the wrong tool for them. It fits interactive MCP clients better. The first Privilege test will tell us more.
- **The path checker is not in CI.** `npm run hosted-access:verify` compares the ingress with its list, but nothing runs it automatically that we could find. Wiring it into CI would stop the three lists drifting apart unnoticed.
- **The SE cluster is shared.** The route is live on the shared SE host, so run `./run-pingaws.sh undeploy` when the demo session ends.
- **A security trade-off was made.** We opened a small hole in a fail-closed host. It was chosen deliberately (exact paths, not a prefix) and is limited to 17 paths.

## Next steps

1. In the Privilege console, add `https://ai-demo.ping-devops.com/api/cimd/privilege/langchain-agent/client-metadata.json` as Type Public, and record the Status.
2. If the Status shows the name and a redirect count, repeat for the other agents.
3. Try a real sign-in with one of those client ids, to confirm the redirect address is accepted end to end.
4. Decide whether the server-side agents need this at all, or whether it is only for interactive MCP clients.

## Appendix

### Verify a document from any machine

```
curl -s https://ai-demo.ping-devops.com/api/cimd/privilege/langchain-agent/client-metadata.json
```

Expect a 200 and JSON whose `client_id` equals that URL.

### The 17 slugs

`super-banking-ai-agent`, `super-banking-investment-advisor-agent`, `super-banking-records-specialist-agent`, `super-banking-purchase-specialist-agent`, `super-banking-membership-specialist-agent`, `super-banking-payroll-specialist-agent`, `super-banking-tax-records-specialist-agent`, `super-banking-financial-aid-specialist-agent`, `super-banking-supplier-contract-specialist-agent`, `super-banking-holdings-specialist-agent`, `super-banking-passenger-records-specialist-agent`, `super-banking-fraud-watch-agent`, `super-banking-balance-sweep-agent`, `super-banking-agent`, `super-banking-identity-verification-specialist-agent`, `langchain-agent`, `demo-agent-service`.

### Where things live

| What | File |
|---|---|
| Document route | `demo_api_server/routes/cimdAgentMetadata.js` |
| Route test | `demo_api_server/src/__tests__/cimdPrivilegeMetadata.route.test.js` |
| BFF gate list | `demo_api_server/middleware/hostedAccessGate.js` (`EXACT_BYPASSES`) |
| Ingress list | `k8s/aws/se-ingress.yaml` (`ai-demo-oauth-bypass-ingress`) |
| Path checker | `scripts/check-hosted-access-ingress.js` |

**Adding an agent.** For an agent already in the scope topology the route works automatically. For any other agent, add it to `PRIVILEGE_EXTRA_AGENTS` in the route. In both cases, add its path to the three lists (ingress, gate, checker), or it stays behind the sign-in gate. Then apply the ingress and redeploy the BFF.
