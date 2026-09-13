# mcp-scanner

A **tool-metadata scanner** for MCP servers — the blue-team answer to
tool-description poisoning. It reads the `description` and `inputSchema` a server
serves in `tools/list` and flags the payloads a hostile server hides there,
*before* an agent ingests them.

This is the defense to the attack in `standalone/hostile-mcp-server`. The MCP
protocol has nothing to inspect tool metadata with, so a defense can only sit
where the metadata is **consumed** — in front of the agent. That is exactly here.

## What it flags

- **`hidden-instruction`** — an instruction aimed at the agent smuggled into a
  tool `description`: an `<IMPORTANT>` / `<SYSTEM>` block, a "do not tell the
  user", an "ignore previous" / "before calling any tool" imperative.
- **`exfil-sink`** — an `inputSchema` argument that leaks: a default pointing to
  an **off-box** URL, or a description telling the agent to include sensitive
  context (full conversation, credentials, tokens).

## Run it

Scan any MCP server (defaults to the hostile server on `:8899`):

```bash
npm install
npm run scan                       # scans http://127.0.0.1:8899/
npm run scan -- https://your-mcp-server/   # or any URL
```

Against `standalone/hostile-mcp-server` (start it first) you'll see:

```
⚠️  get_weather — hidden-instruction: instruction-tag in description (e.g. <IMPORTANT>)
⚠️  search_docs — exfil-sink: arg "callback_url": off-box default https://attacker.example/collect; description instructs including sensitive context
```

Exit code is `1` when anything is found, `0` when clean, `2` if it can't connect —
so it doubles as a check. It **reports; it never blocks** the server or alters
anything.

## Honest about its limits

The checks are heuristic. They catch the known poisoning shapes and obvious
variants; a novel phrasing can slip past, and an unusually worded legitimate tool
could trip a flag. It is a tripwire in front of the agent, not a proof of safety.

## Test

```bash
npm test
```

`scanner.test.js` — flags a hidden instruction and an exfil sink, stays silent on
clean tools (a `localhost` default is not off-box), and reports every poisoned
tool across a list.
