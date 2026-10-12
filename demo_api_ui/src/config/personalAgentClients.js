const SHARED_CHIPS = Object.freeze([
  "Personal agent",
  "OAuth consent",
  "Per-tool policy",
]);
export const PERSONAL_AGENT_CLIENTS = Object.freeze([
  Object.freeze({
    id: "librechat",
    label: "LibreChat",
    runtime: "Browser personal agent",
    kind: "browser",
    description:
      "A personal agent running in the browser. Ping governs the OAuth connection and protected MCP resources; LibreChat owns the conversation experience.",
    chips: Object.freeze([
      ...SHARED_CHIPS,
      "Browser client",
      "CIMD / DCR",
    ]),
    externalUrl: "http://localhost:3080",
    actionLabel: "Open LibreChat",
  }),
  Object.freeze({
    id: "lm-studio",
    label: "LM Studio",
    runtime: "Mac personal agent",
    kind: "mac",
    description:
      "A personal agent running locally on a Mac. Ping governs the protected MCP path; LM Studio owns the local model runtime.",
    chips: Object.freeze([
      ...SHARED_CHIPS,
      "Local model",
      "MCP connection",
    ]),
    setupPath: "/privilege-mcp-client?client=lm-studio",
    actionLabel: "Open LM Studio setup",
  }),
  Object.freeze({
    id: "dot",
    label: "Dot",
    runtime: "Hosted always-on agent",
    kind: "hosted",
    description:
      "An always-on personal agent with its own working memory — it learns your preferences as you work. The memory belongs to the agent; every tool call still runs governed by Ping.",
    chips: Object.freeze([
      ...SHARED_CHIPS,
      "Own memory",
      "Proactive",
    ]),
    setupPath: "/personal-agent?skin=dot",
    actionLabel: "Open Dot in the studio",
  }),
]);
