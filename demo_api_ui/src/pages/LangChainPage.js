// demo_api_ui/src/pages/LangChainPage.js
// /langchain — LangChain agent runtime + current brain/framework inventory
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
// P4 cards, P5 kv, P7 chips. P9: this page has no action buttons (its only controls are links), so it has
// no primary button and none is invented. Honesty: the architecture, code sample and both tables are fixed
// text, nothing runs here; only the Active brain card is read live from the BFF.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import InlineSpinner from "../components/shared/InlineSpinner";
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from "../components/pingUi";
import "./LangChainPage.css";

const LCEL_CODE = `# LangChain / LangGraph agent — tools via BFF (AG-UI)
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage

# llm_factory resolves provider from BFF session (google / llamacpp / helix / …)
llm = get_llm(provider=cfg.provider, model=cfg.model)

# ONE checkpointer for the agent's lifetime — rebuilding it on every
# refresh_tools() call would wipe every session's history.
checkpointer = MemorySaver()

graph = create_react_agent(
    model=llm,
    tools=mcp_tools,           # banking tools through BFF /internal/agent-tool
    pre_model_hook=trim_history_hook,
    checkpointer=checkpointer,
)

async def run(user_msg: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    async for event in graph.astream_events(
        {"messages": [HumanMessage(content=user_msg)]},
        config=config,
        version="v2",
    ):
        yield event  # mapped to AG-UI SSE by the FastAPI /run handler
`;

/** Demo-primary brains (agent mode picker). provider matches status.provider when set. */
const DEMO_BRAINS = [
  {
    id: "heuristics",
    label: "Heuristics",
    provider: null,
    package: "— (BFF NL parser)",
    defaultModel: "n/a",
    notes: "Deterministic NL → tool path; no API key",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "google",
    package: "langchain-openai (Gemini's OpenAI-compat endpoint)",
    defaultModel: "gemini-2.0-flash",
    notes: "Fast cloud LLM for SE demos — GOOGLE / Gemini key",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    provider: "llamacpp",
    package: "langchain-openai (OpenAI-compat)",
    defaultModel: "via demo_llm_proxy :8090",
    notes: "Local GGUF through LLM proxy — no cloud key",
  },
];

const ALL_FRAMEWORKS = [
  ["langchain_agent", "LangChain / LangGraph", "8888", "Default — llm_framework=langchain"],
  ["llamaindex_agent", "LlamaIndex", "8894", "RAG profile — not llm_framework"],
  ["compliance_agent", "Compliance (Pydantic AI)", "3007", "AML specialist microservice"],
];

const DIAGRAM = `Browser  ──►  AIAgent  ──►  BFF
                           │  llm_framework + agent_mode (brain)
                           ├─►  langchain_agent :8888  (AG-UI SSE)
                           │      LangGraph / LCEL + llm_factory
                           └─►  /internal/agent-tool  ──►  MCP gateway
                                                          Ping Authorize`;

const HEURISTIC_IDS = new Set(["heuristics", "heuristic"]);
const LOCAL_PROVIDERS = new Set(["llamacpp", "anthropic-lmstudio"]);

/** What the banner says about the one live part of the page, from the request that actually ran. */
const BANNER_LIVE_LINE = {
  loading: "The Active brain card is being read from the BFF now.",
  ready:
    "Only the Active brain card is live: it is read from the BFF (/api/langchain/config/status), key flags only, never key material.",
  unavailable:
    "The BFF did not answer, so the Active brain card has nothing to show and no brain or key is claimed.",
};

/** A code or diagram block that can scroll sideways. It is a named region so the keyboard can reach it. */
function CodeBlock({ label, children, ...rest }) {
  return (
    <pre className="lcp-pre" tabIndex={0} role="region" aria-label={label} {...rest}>
      <code>{children}</code>
    </pre>
  );
}

export default function LangChainPage() {
  const [status, setStatus] = useState(null);
  // loading until the BFF answers; unavailable when it does not (so the card never spins forever)
  const [statusState, setStatusState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/langchain/config/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setStatus(d);
          setStatusState("ready");
        } else {
          setStatusState("unavailable");
        }
      })
      .catch(() => {
        if (!cancelled) setStatusState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProvider = status?.provider ?? null;
  const isHeuristic = !activeProvider || HEURISTIC_IDS.has(activeProvider);

  // The chip word says what the BFF reported; colour only follows it. Green only for a key the BFF says is set.
  let chip;
  let cardTone;
  if (statusState === "loading") {
    cardTone = "neutral";
    chip = { tone: "neutral", word: "Checking" };
  } else if (statusState === "unavailable") {
    cardTone = "warn";
    chip = { tone: "warn", word: "Not reachable" };
  } else if (isHeuristic) {
    cardTone = "live";
    chip = { tone: "info", word: "No key needed" };
  } else if (status?.key_set?.[activeProvider]) {
    cardTone = "live";
    chip = { tone: "ok", word: "Key set" };
  } else if (LOCAL_PROVIDERS.has(activeProvider)) {
    cardTone = "live";
    chip = { tone: "neutral", word: "Local, no key" };
  } else {
    cardTone = "live";
    chip = { tone: "danger", word: "No key set" };
  }

  const brainItems = [
    { label: "Provider", value: isHeuristic ? "heuristics" : activeProvider, mono: true },
    { label: "Model", value: isHeuristic ? "none (deterministic NL parser)" : status?.model ?? "not reported", mono: !isHeuristic },
  ];

  return (
    <PingPage className="lcp">
      <SimBanner data-testid="lcp-banner">
        Reference page. The architecture, code sample and both tables below are fixed text; nothing runs on this
        page. {BANNER_LIVE_LINE[statusState]}
      </SimBanner>

      <PageHeader
        back={{ to: "/", label: "Back" }}
        eyebrow="Agent frameworks"
        title="LangChain in AI Demo"
        summary="Default banking AG-UI runtime (langchain_agent on :8888). Same Ping delegated-OAuth / MCP / Authorize / HITL model as the other frameworks: switch package with llm_framework, switch brain with the agent mode picker (Heuristics · Gemini · llama.cpp)."
      />

      <PageFrame>
        <Section id="lcp-active" kicker="1 · Right now" title="Active brain / provider">
          <CardGrid>
            <Card tone={cardTone} title="Session brain" data-testid="lcp-active-brain">
              <div className="pu-status-line">
                {/* the spinner is itself a live region, so it sits beside this one, not inside it */}
                <span className="pu-status-line" role="status" aria-live="polite">
                  <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
                  {statusState === "unavailable" && (
                    <span>The BFF status endpoint did not respond.</span>
                  )}
                  {statusState === "ready" && isHeuristic && <span>No LLM key required.</span>}
                  {statusState === "ready" && !isHeuristic && chip.tone === "danger" && (
                    <span>Set one in Config or the agent mode picker.</span>
                  )}
                </span>
                {statusState === "loading" && <InlineSpinner label="Reading the active brain…" />}
              </div>
              {statusState === "ready" && <KvList items={brainItems} />}
              <p className="pu-note">
                <Link to="/config" className="lcp-link">Change in Config →</Link>
              </p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="lcp-arch" kicker="2 · How it fits" title="Architecture">
          <Card tone="neutral">
            <p className="lcp-intro">
              <code>langchain_agent</code> is a Python FastAPI service (AG-UI <code>/run</code> on port 8888). The
              BFF selects it when <code>llm_framework=langchain</code> (default) and forwards the session brain
              (provider + model) from <code>/api/langchain/config</code>. Tools execute through the BFF with the
              delegated Ping token, never with long-lived secrets in the browser.
            </p>
            <CodeBlock label="Architecture diagram (text)" data-testid="lcp-diagram">{DIAGRAM}</CodeBlock>
          </Card>
        </Section>

        <Section id="lcp-pattern" kicker="3 · Pattern" title="LangGraph / LCEL pattern">
          <Card tone="neutral">
            <CodeBlock label="LangGraph agent code sample" data-testid="lcp-code">{LCEL_CODE}</CodeBlock>
            <p className="pu-note">
              Source: <code>langchain_agent/</code> (AG-UI run handler + LLM factory). Framework comparison: Learn →
              Agent frameworks, or <code>AGENTS_ECOSYSTEM.md</code>.
            </p>
          </Card>
        </Section>

        <Section
          id="lcp-brains"
          kicker="4 · Brains"
          title="Demo brains (Heuristics · Gemini · llama.cpp)"
          lede="These are the usual live-demo choices in the agent mode picker. Other modes (Helix, Anthropic, MLX, Groq) appear when configured; see agentModes.js."
        >
          <Card tone="neutral">
            <div className="lcp-table-wrap">
              <table className="lcp-table" data-testid="lcp-brains" aria-label="Demo brains">
                <thead>
                  <tr>
                    {["Brain", "Provider id", "Package / path", "Default model", "Notes"].map((h) => (
                      <th key={h} scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEMO_BRAINS.map((p) => {
                    // Marked active only once the BFF has answered; before that nothing is claimed.
                    const active =
                      statusState === "ready" &&
                      ((p.provider == null && isHeuristic) ||
                        (p.provider != null && activeProvider === p.provider));
                    return (
                      <tr key={p.id} className={active ? "lcp-row--active" : undefined}>
                        <td data-label="Brain">
                          {p.label}
                          {active && (
                            <span className="lcp-cell-chip"><StatusChip tone="info">Active</StatusChip></span>
                          )}
                        </td>
                        <td data-label="Provider id"><code>{p.provider ?? "null"}</code></td>
                        <td data-label="Package / path"><code>{p.package}</code></td>
                        <td data-label="Default model"><code>{p.defaultModel}</code></td>
                        <td data-label="Notes">{p.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        <Section id="lcp-security" kicker="5 · Security" title="Security: Keys Stay Server-Side">
          <Card>
            <p className="lcp-intro">
              API keys live in <code>req.session.langchain_config</code> on the BFF only.{" "}
              <code>GET /api/langchain/config/status</code> returns boolean <code>key_set</code> flags, never key
              material. Same pattern as PingOne client secrets.
            </p>
          </Card>
        </Section>

        <Section
          id="lcp-agents"
          kicker="6 · Inventory"
          title="All agents we have"
          lede="Framework packages in this repo. Banking chat swaps among the first four via llm_framework; LlamaIndex and Compliance are separate services. Brains above are independent of which package runs."
        >
          <Card tone="neutral">
            <div className="lcp-table-wrap">
              <table className="lcp-table" data-testid="lcp-agents" aria-label="Agent framework packages">
                <thead>
                  <tr>
                    {["Directory", "Framework", "Port", "Role"].map((h) => (
                      <th key={h} scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_FRAMEWORKS.map((row) => {
                    const here = row[0] === "langchain_agent";
                    return (
                      <tr key={row[0]} className={here ? "lcp-row--active" : undefined}>
                        <td data-label="Directory">
                          <code>{row[0]}</code>
                          {here && (
                            <span className="lcp-cell-chip"><StatusChip tone="neutral">This page</StatusChip></span>
                          )}
                        </td>
                        <td data-label="Framework">{row[1]}</td>
                        <td data-label="Port">{row[2]}</td>
                        <td data-label="Role">{row[3]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="pu-note">
              Full write-up: <code>AGENTS_ECOSYSTEM.md</code> · In-app: Learn → Agent frameworks (inventory).
            </p>
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
