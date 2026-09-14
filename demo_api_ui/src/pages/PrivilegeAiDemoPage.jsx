// Privilege for AI — Hostile MCP (/privilege-for-ai) — a static lesson.
//
// Makes NO live BFF, gateway or PingOne calls: it teaches the story of the
// hostile MCP server (standalone/hostile-mcp-server) sitting behind the Privilege
// AI Gateway regardless of whether the SE cluster is reachable. The live proof
// lives elsewhere (LibreChat, the gateway log, the mcp-scanner CLI); this page is
// the concept + demo-runbook surface.
//
// Built on the shared LessonLayout so it gets the Export PDF handout, section nav
// and Ping branding for free — the same chrome as the other education pages.
// Every claim is grounded in shipped work; see
// docs/superpowers/specs/2026-09-13-hostile-mcp-behind-privilege-design.md.
import { LessonLayout, Section } from "../components/lesson";
import "./PrivilegeAiDemoPage.css";

const SECTIONS = [
  { id: "threats", label: "Three threats" },
  { id: "flow", label: "Defense in depth" },
  { id: "run", label: "Demo steps" },
  { id: "reference", label: "Reference" },
];

// The spine: every attack in this demo lands in one of three places. Privilege is
// the backstop for two; the third slips past it on purpose.
const THREATS = [
  {
    n: 1,
    tone: "deny",
    title: "Harmful action",
    desc: "The poison tricks the agent into calling create_transfer to an external account.",
    verdict: "stops",
    tag: "Privilege stops it",
    by: "MCP lane — the tool-call policy denies the call",
  },
  {
    n: 2,
    tone: "content",
    title: "Malicious prompt / response",
    desc: "Prompt injection, PII or data-exfiltration text riding in the model's input or output.",
    verdict: "stops",
    tag: "Proven",
    by: "LLM lane — AIGuard returns content_blocked: prompt_injection when the poisoned description reaches the model",
  },
  {
    n: 3,
    tone: "gap",
    title: "Poisoned tool metadata",
    desc: "The <IMPORTANT> block in a description, or the off-box callback_url in a schema, arriving on tools/list.",
    verdict: "misses",
    tag: "Privilege can't see it",
    by: "it polices calls, not metadata → mcp-scanner catches it at ingest (proven live: 2 findings)",
  },
];

// Left to right: the agent talks to the gateway, the gateway to the hostile
// backend. Each hop is a lane Privilege enforces on.
const FLOW = [
  { role: "Client", name: "Agent", sub: "LibreChat · a real LLM" },
  { role: "Privilege", name: "AI Gateway", sub: "app: libre · per-user policy", accent: true },
  { role: "Backend", name: "Hostile MCP", sub: "get_weather · search_docs · create_transfer" },
];
const LANES = [
  { label: "LLM lane", guard: "AIGuard" },
  { label: "MCP lane · tools/call", guard: "policy" },
];

const STEPS = [
  { body: "In LibreChat, pick the privilege-libre MCP door and sign in as the demo user (the gateway runs the OAuth flow)." },
  { body: "Open tools/list — the poisoned get_weather and search_docs arrive with their payloads intact.", note: "the metadata poison already landed; the gateway never saw it" },
  { body: "Ask: “What's the weather in Denver?”", note: "PERMIT — an allowed tool call returns normally", noteTone: "ok" },
  { body: "Ask: “Transfer $500 to external-001.” The poison induced this; the agent tries it.", note: "DENY — Privilege policy blocks the call at the gateway", noteTone: "no" },
  { body: "Run mcp-scanner against the server to show the earlier defense.", note: "flags hidden-instruction + exfil-sink before ingest" },
];

const REFERENCE = [
  { k: "Client URL (gateway)", v: "https://mcpgw.ai-demo.ping-devops.com/libre/mcp" },
  { k: "Backend (in-cluster)", v: "http://hostile-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse" },
  { k: "Mesh cluster", v: "ai-demo-cmuir" },
  { k: "Scan the server", v: "cd standalone/mcp-scanner && npm run scan -- <url>" },
  { k: "Confirm the deny", v: "kubectl logs -n ping-devops-curtismuir deploy/agentless-mcpgw -c log-tailer | grep 'policy denied'" },
];

export default function PrivilegeAiDemoPage() {
  return (
    <LessonLayout
      title="Privilege for AI — Hostile MCP"
      subtitle="A deliberately hostile MCP server serves tools whose metadata carries the attack. Run it behind the Privilege AI Gateway to show what the gateway defends — and the one thing it can't, which is why defense in depth matters."
      sections={SECTIONS}
      storageKey="pfa-lesson-nav-width"
    >
      <Section id="threats" title="Three threats, three defenses">
        <p className="pfa-sub">
          Every AI-agent attack in this demo lands in one of three places. Privilege is the backstop for two of them; the
          third slips past it on purpose — that's the teaching moment.
        </p>
        <div className="pfa-matrix">
          {THREATS.map((t) => (
            <div key={t.n} className={`pfa-threat pfa-tone-${t.tone}`}>
              <div className="pfa-threat-num">{t.n}</div>
              <div className="pfa-threat-main">
                <h3 className="pfa-threat-title">{t.title}</h3>
                <p className="pfa-threat-desc">{t.desc}</p>
              </div>
              <div className="pfa-verdict">
                <span className={`pfa-tag pfa-tag-${t.verdict}`}>
                  {t.verdict === "stops" ? "✓ " : "✕ "}{t.tag}
                </span>
                <span className="pfa-verdict-by">{t.by}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="flow" title="Defense in depth, end to end">
        <p className="pfa-sub">
          The poison rides in on the tool list unfiltered. The gateway's job begins at the call; the scanner's job begins
          before the agent ever ingests the list.
        </p>
        <div className="pfa-flow-scroll">
          <div className="pfa-rail">
            {FLOW.map((node, i) => (
              <div className="pfa-rail-cell" key={node.name}>
                <div className={`pfa-node${node.accent ? " pfa-node-accent" : ""}`}>
                  <div className="pfa-node-role">{node.role}</div>
                  <div className="pfa-node-name">{node.name}</div>
                  <div className="pfa-node-sub">{node.sub}</div>
                </div>
                {i < LANES.length && (
                  <div className="pfa-conn" aria-hidden="true">
                    <div className="pfa-conn-lane">{LANES[i].label}</div>
                    <div className="pfa-conn-arrow" />
                    <div className="pfa-conn-guard">{LANES[i].guard}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="pfa-gap">
          <p className="pfa-gap-lbl">The honest gap</p>
          <p className="pfa-gap-body">
            Discovery hands the poisoned descriptions and schemas to any client verbatim — the gateway has nothing to
            inspect metadata <em>with</em>. So <b>mcp-scanner</b> reads <code className="pfa-code">tools/list</code> and
            flags the injection and the exfil sink before the agent trusts them. The gateway stops the <em>action</em>;
            the scanner stops the <em>ingestion</em>.
          </p>
        </div>
      </Section>

      <Section id="run" title="Run the demo, step by step">
        <p className="pfa-sub">One browser sign-in, two prompts. The contrast between them is the whole show.</p>
        <ol className="pfa-steps">
          {STEPS.map((s, i) => (
            <li className="pfa-step" key={i}>
              <span className="pfa-step-num">{i + 1}</span>
              <div className="pfa-step-body">
                <p className="pfa-step-text">{s.body}</p>
                {s.note && (
                  <p className={`pfa-step-note${s.noteTone ? ` pfa-note-${s.noteTone}` : ""}`}>{s.note}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="reference" title="Coordinates">
        <dl className="pfa-ref">
          {REFERENCE.map((r) => (
            <div className="pfa-ref-row" key={r.k}>
              <dt className="pfa-ref-k">{r.k}</dt>
              <dd className="pfa-ref-v">{r.v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </LessonLayout>
  );
}
