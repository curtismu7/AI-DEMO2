# The Same MCP-Client Work Against LM Studio

**Date:** 2026-08-24
**Status:** Research complete (external-facts spike, sourced below), design not yet approved
**Related:** `docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md` (the four LibreChat doors), `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md` (the façade + embedded reel this spec reuses the backend half of).

## 1. Why this exists

LM Studio is a second local-model desktop app already in this repo's orbit (it's a natural companion to the `demo_llm_proxy/` local-tier work). The question: can the same thing built for LibreChat — the four MCP doors, and the façade-recorded, embedded trace reel — be replicated against it, and should LM Studio itself be forked the way `librechat/`'s design already considered (and rejected) forking LibreChat.

This spec is the answer to that question, grounded in current LM Studio documentation rather than assumption — LM Studio's MCP/plugin surface is new enough (MCP support shipped in v0.3.17) that guessing from training data would have been actively wrong. Sources are cited inline; verify against current docs before implementing, since this is exactly the kind of external fact that drifts.

### The decisive fact: forking is not a design choice here, it's impossible

LM Studio (developed by Element Labs) is **free to use but closed-source** — no public repository, no official fork exists, unlike LibreChat where forking was possible but rejected on cost grounds. There is nothing to fork. Any embedded-UI ambition for LM Studio has to work within its sanctioned, first-party extensibility surface (§3) or not happen at all.

Sources: [LM Studio is free for use at work — LM Studio Blog](https://lmstudio.ai/blog/free-for-work); no official GitHub repository for the desktop app exists (searched 2026-08-24).

## 2. What maps over directly

The ledger/hop-recording backend from the embedded-trace spec (§3–§4 there: `POST /internal/transaction-hop`, `transactionAssembler.assemble()`, the compact `/transaction-trace/embed/:correlationId` view) is **entirely client-agnostic** — it doesn't know or care whether the MCP client on the other end is LibreChat or LM Studio. Nothing there needs to change or duplicate.

LM Studio also has two things LibreChat's core chat lacks, which simplifies part of this work:

- **A native per-chat MCP-server picker** — a dropdown at the bottom of the chat lets you choose which configured MCP server is active for that conversation. LibreChat has no equivalent in core (non-Agent) chat; MCP access there is Agent-scoped only. This directly answers the standing "how do we pick which server" question — for LM Studio, nothing needs to be built.
- **`mcp.json`** (Cursor-style notation, since v0.3.17) — per-server `streamable-http`/`stdio` config with per-server auth headers, edited via the in-app "Program" tab. The four doors map onto four `mcp.json` entries the same way they map onto four `librechat.yaml` `mcpServers` entries.

Sources: [Use MCP Servers — LM Studio](https://lmstudio.ai/docs/app/mcp); [MCP in LM Studio — LM Studio Blog (v0.3.17)](https://lmstudio.ai/blog/lmstudio-v0.3.17).

## 3. What's genuinely different: the Tools Provider plugin

LM Studio ships a first-party plugin SDK (`@lmstudio/sdk`, TypeScript, runs on the app's bundled Node.js) with several hook types; the relevant one is the **Tools Provider**, which registers tools *in-process* — no external MCP server needed at all:

```ts
import { tool, type ToolsProviderController } from '@lmstudio/sdk';
import { z } from 'zod';

const myTool = tool({
  name: '...',
  description: '...',
  parameters: z.object({ /* ... */ }),
  implementation: async (args) => { /* ... */ return result; },
});
// registered in index.ts via: context.withToolsProvider(toolsProvider)
```

This is a **better** integration point than the LibreChat façade for the two gateway doors: instead of a separate recording-proxy service LM Studio's MCP client talks to over HTTP, the façade's relay-and-record logic (OAuth session management toward the real gateway, ledger hop emission) could run *inside* a Tools Provider plugin's `implementation` function directly — one fewer network hop, one fewer service to run. The `implementation` function is `async`, and nothing in the documented API restricts it from making outbound HTTP calls (posting hops to `/internal/transaction-hop`, relaying to the real gateway) — this is standard Node.js code, not a sandboxed/restricted runtime as far as the docs describe, though no example in the official docs demonstrates an outbound network call, so this should be verified empirically early in implementation rather than assumed.

Sources: [Introduction to Plugins — LM Studio](https://lmstudio.ai/docs/typescript/plugins); [Tools Provider Plugins — DeepWiki](https://deepwiki.com/lmstudio-ai/docs/6.2-tools-provider-plugins); example source: [lmstudio/dice toolsProvider.ts](https://lmstudio.ai/lmstudio/dice/files/src/toolsProvider.ts).

## 4. What's missing: no confirmed path to an embedded reel

This is the open risk, and it's a real one, not glossed over. A Tools Provider's `implementation` function returns a **plain string or plain object** — confirmed from the official `dice` and `create_file` examples, both of which return bare text. LM Studio's chat renders standard Markdown + GFM (tables, code blocks, images) — nothing in the documentation or the plugin API confirms raw-HTML or iframe rendering, and no hook type (`Tools Provider`, `Prompt Preprocessor`, `Generator`, `Custom Configuration`) is documented as able to render a custom UI panel or sidebar. LibreChat's mechanism (`:::artifact{type="application/vnd.code-html"}`, rendered in its Artifacts side panel) has **no confirmed LM Studio equivalent.**

Two realistic fallbacks, neither as good as the LibreChat embed:

- **Plain link**, identical to the LibreChat design's own fallback (§5.4 there) — the tool result includes the `reel_url` text, LM Studio renders it as a clickable Markdown link. Zero risk, but not "embedded."
- **Static image snapshot** — since LM Studio confirmedly renders images in chat, the tool result could include a Markdown image tag pointing at a server-rendered PNG/SVG snapshot of the filmstrip at call-completion time. This gets a visual "reel" back into the chat itself, but it's a snapshot, not a live/interactive panel — no scrubbing between hops the way the LibreChat mockup's CSS-tab filmstrip allows.

Sources: [Working with Chats — LM Studio](https://lmstudio.ai/docs/typescript/llm-prediction/working-with-chats); [Single Tool — LM Studio](https://lmstudio.ai/docs/typescript/plugins/tools-provider/single-tool); [Introducing LM Studio 0.4.0](https://lmstudio.ai/blog/0.4.0) (image-rendering fix, confirms images render in messages).

## 5. Recommendation

1. **Doors first, cheap, config-only:** four `mcp.json` entries mirroring the four `librechat.yaml` ones. No plugin needed for the two direct doors (`aidemo-mcp`, `opensearch-direct`) — same reasoning as LibreChat, nothing to record.
2. **Gateway doors as a Tools Provider plugin, not a second façade service** — reuse the *design* (persisted upstream OAuth session, ledger hop emission per phase) from the embedded-trace spec's §3, but host it in-process as an LM Studio plugin rather than a standalone HTTP façade. Verify the outbound-network-call assumption (§3) with a throwaway plugin before committing to this shape.
3. **Reel: ship the plain-link fallback first, evaluate the image-snapshot upgrade after.** Don't attempt to invent an embedded-panel mechanism LM Studio doesn't document — that's the kind of speculative build this repo's own CLAUDE.md warns against. If LM Studio ships a UI-extension hook later, revisit.
4. **Do not fork.** Settled by §1 — there's nothing to fork.

## 6. Open questions for the implementation plan

- Can a Tools Provider's `implementation` genuinely make outbound HTTP calls and maintain persistent state (an OAuth token) across invocations? Confirm empirically first — this is the load-bearing assumption in §3/§5.2.
- Exact `mcp.json` schema for `streamable-http` transport with custom headers (the docs' worked example uses a Bearer header for Hugging Face; the `aidemo-mcp` door needs the same trivial no-op-header trick used in `librechat.yaml` today, or LM Studio may not need it at all if it doesn't run the same startup OAuth-detection probe LibreChat does — verify, don't assume the LibreChat-specific workaround is needed here too).
- Whether the image-snapshot reel upgrade (§4) is worth building at all, or whether the plain link is sufficient for this repo's demo purposes.
