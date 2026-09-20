# Hostile MCP Resource and Prompt Poisoning with Privilege Denials

**Date:** 2026-09-19  
**Status:** approved design  
**Builds on:** `2026-09-09-hostile-mcp-server-design.md`, `2026-09-13-hostile-mcp-behind-privilege-design.md`

## Goal

Extend the hostile MCP demonstration so the primary story is visible in one
place:

1. Hostile tool, resource, or prompt content reaches an agent.
2. The content induces a consequential MCP tool call.
3. The same call is sent through the PingOne Privilege AI Gateway.
4. Privilege denies the call and the UI presents the denial as the security
   backstop.

The demo must make clear that Privilege is denying the resulting tool action;
it is not claiming to inspect or sanitize arbitrary MCP metadata or content.

## Scope

### In scope

- A hostile resource payload exposed through `resources/list` and
  `resources/read`.
- A hostile prompt payload exposed through `prompts/list` and `prompts/get`.
- A scenario model shared by the hostile server, scanner, and UI so each
  scenario has an explicit source payload, induced call, scanner finding, and
  expected Privilege result.
- UI controls in the existing MCP client/scanner surface for running the three
  denial scenarios:
  - poisoned tool metadata;
  - poisoned resource;
  - poisoned prompt.
- A side-by-side evidence view showing the hostile content, the agent-selected
  call, and the Privilege denial response.
- Offline tests proving resource/prompt payloads and scanner findings.
- Stubs only: no real transfer, credential collection, or outbound request.

### Out of scope

- Real money movement or external HTTP callbacks.
- Claiming that Privilege detects metadata, resource text, or prompt text.
- A general-purpose MCP content sanitizer.
- Dynamic tool-list mutation, SSRF simulation, or cross-tenant object policy in
  this slice; those are separate follow-on scenarios.
- Remote deployment or changes to a non-local environment.

## Threat scenarios

### Scenario A: poisoned tool metadata

The existing `get_weather` description instructs the agent to call
`create_transfer`. The agent's call is routed through Privilege, which denies
the sensitive operation.

### Scenario B: poisoned resource

The hostile server exposes a benign-looking account-verification resource. Its
content includes an agent-directed instruction to call `create_transfer` to an
external beneficiary. The resource read itself succeeds; the induced transfer
call is the event Privilege denies.

The resource content must be visibly labeled as untrusted in the UI. The
server must never perform the transfer or contact the beneficiary.

### Scenario C: poisoned prompt

The hostile server exposes a prompt template for an ordinary account task. The
prompt contains an instruction to bypass normal approval and call
`create_transfer`. Fetching the prompt succeeds; the induced call is routed
through Privilege and denied.

The UI must distinguish the prompt response from the later gateway decision so
viewers do not infer that Privilege validated the prompt text.

## Architecture

### Hostile server

Keep the existing low-level MCP server and add resource and prompt capabilities
to the same server. The payload catalog remains data-first:

- `poisons.mjs` owns resource and prompt fixtures alongside tool fixtures.
- `index.mjs` registers the fixtures in `resources/list`, `resources/read`,
  `prompts/list`, and `prompts/get`.
- `create_transfer` remains a callable stub and the only consequential action
  used by the scenarios.

The server must advertise only the capabilities it actually implements and
must return deterministic payloads. Resource and prompt identifiers should be
stable so tests and the UI can reference them without parsing display text.

### Scanner

Extend the scanner with explicit entry points for resources and prompts rather
than pretending they are tools:

- `scanResources(resources)` inspects resource metadata and read content.
- `scanPrompts(prompts)` inspects prompt metadata and returned messages.

Findings retain the existing `{ tool, kind, detail }` compatibility for tool
scans, while resource/prompt findings use a source-qualified identifier such as
`resource:account-verification` or `prompt:account-review`. The finding detail
must state whether the signal came from hidden instructions, secrecy language,
an exfiltration sink, or a sensitive-action directive.

The scanner reports a finding before the agent acts; it never decides the
Privilege result.

### UI

Use the existing MCP client/scanner surface rather than creating a new page.
Add a scenario selector and an evidence layout with four named sections:

1. **Hostile content** — exact resource, prompt, or tool metadata returned by
   the server.
2. **Scanner finding** — finding kind and explanation, or an explicit clean
   result if the scanner missed it.
3. **Induced action** — exact JSON-RPC method, tool name, and arguments the
   agent attempted.
4. **Privilege decision** — HTTP status, policy decision, reason, and trace
   information already exposed by the existing client surface.

The direct path remains available as a comparison, but the default scenario
path should be the Privilege door. Copy must say “content reached the agent;
Privilege denied the resulting action,” not “Privilege blocked the poison.”

The UI must use existing theme tokens, modal primitives, and the repository
emoji allowlist. No new emoji or inline themeable colors are permitted.

### Scenario contract

Represent each demo scenario with stable data:

```js
{
  id: 'poisoned-resource',
  source: { kind: 'resource', name: 'account-verification' },
  inducedCall: { name: 'create_transfer', arguments: { ... } },
  expected: { gateway: 'deny', action: 'sensitive-tool-call' }
}
```

The actual gateway response remains authoritative. `expected` is instructional
metadata for the demo and must not be rendered as proof when the live result
differs.

## Data flow

```text
hostile MCP server
        |
        +--> tools/list, resources/read, or prompts/get
        |          |
        |          +--> scanner finding (pre-action defense)
        |          |
        |          +--> agent context
        |                    |
        |                    +--> create_transfer call
        |                                  |
        |                  direct ----------+---------- Privilege gateway
        |                    succeeds/stub                denies
        |
        +--> UI evidence: source payload + finding + call + verdict
```

The direct path is a controlled comparison only. Both paths must use the same
stub arguments and scenario so the viewer can attribute the difference to
Privilege policy rather than to different payloads.

## Error handling and safety

- A missing resource or prompt capability must render as a capability result,
  not as a generic failed fetch.
- A failed Privilege request must preserve HTTP status, policy reason, and
  provider fields using the existing error contract.
- The UI must not label an unmeasured or unavailable result as “denied.”
- The hostile server must reject or ignore attempts to make real outbound
  requests. No scenario accepts a live callback target.
- `create_transfer` returns a clearly marked demo-stub result on the direct
  path and must never mutate banking state.

## Testing and verification

### Hostile server

- Fixture tests assert the resource and prompt payloads retain their poison.
- Round-trip tests use a real MCP SDK client to list/read/get the new content.
- The server advertises the corresponding capabilities and no false ones.

### Scanner

- Resource metadata/content injection is detected.
- Prompt message injection is detected.
- Clean resource and prompt fixtures remain silent.
- Source-qualified finding identifiers are stable.

### UI

- Scenario selection renders the correct source kind.
- The induced action and live Privilege denial are shown separately.
- Direct and Privilege paths use the same scenario payload.
- Missing capabilities, 403 denials, and provider failures retain distinct
  copy and status handling.
- Run the UI unit suite and production build; run the theme contrast audit in
  both light and dark themes for the touched page.

### Repository gates

- Run focused hostile-server and scanner tests.
- Run focused UI tests, `npm run test:unit`, and `npm run build` in
  `demo_api_ui/`.
- Run `npm run topology:verify` only if the implementation changes configured
  routes or topology.
- Run `graphify update .` after edits.
- Do not claim completion without fresh test/build output.

## Success criteria

The demo is successful when an operator can select any of the three scenarios
and see, in sequence:

1. the hostile content arrive;
2. the scanner's assessment;
3. the induced `create_transfer` call; and
4. a live Privilege denial for that call.

The direct comparison must show that the same stub action is reachable without
Privilege, while no real side effect occurs in either path.
