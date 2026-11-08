// Privilege for AI — Hostile MCP (/privilege-for-ai) — a static lesson.
//
// Makes NO live BFF, gateway or PingOne calls: it teaches the story of the
// hostile MCP server (standalone/hostile-mcp-server) sitting behind the Privilege
// Agent Privilege regardless of whether the SE cluster is reachable. The live proof
// lives elsewhere (LibreChat, the gateway log, the mcp-scanner CLI); this page is
// the concept + demo-runbook surface.
//
// Built on the shared LessonLayout so it gets the Export PDF handout, section nav
// and Ping branding for free — the same chrome as the other education pages.
// Every claim is grounded in shipped work; see
// docs/superpowers/specs/2026-09-13-hostile-mcp-behind-privilege-design.md.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P4 cards,
// P5 kv, P7 chips, P9 buttons. The page keeps the LessonLayout shell (its title band, section nav, theme
// toggle and Export PDF handout), so P3's PageFrame is not nested inside it: LessonLayout's own content
// column is the 1100px frame. P6 (inspector) does not apply to a static lesson; P8 (diagram boxes) is the
// defense-in-depth rail, kept page-local. P9: the one primary button is the lesson's forward action,
// "Open the MCP Scanner"; the shell's Export PDF and theme toggle are secondary.
import { useNavigate } from "react-router-dom";
import { LessonLayout } from "../components/lesson";
import {
  PingPage, SimBanner, Section, Card, StatusChip, KvList,
} from "../components/pingUi";
import "./PrivilegeAiDemoPage.css";

const SECTIONS = [
  { id: "threats", label: "Three threats" },
  { id: "flow", label: "Defense in depth" },
  { id: "scanner", label: "Blue-team scanner" },
  { id: "run", label: "Demo steps" },
  { id: "reference", label: "Reference" },
];

// The spine: every attack in this demo lands in one of three places. Privilege is
// the backstop for two; the third slips past it on purpose. cardTone/chipTone only add
// colour: the chip always carries the word (P7).
const THREATS = [
  {
    n: 1,
    cardTone: "ok",
    chipTone: "ok",
    title: "Harmful action",
    desc: "The poison tricks the agent into calling create_transfer to an external account.",
    tag: "Privilege stops it",
    by: "MCP lane — the tool-call policy denies the call",
  },
  {
    n: 2,
    cardTone: "ok",
    chipTone: "ok",
    title: "Malicious prompt / response",
    desc: "Prompt injection, PII or data-exfiltration text riding in the model's input or output.",
    tag: "Proven",
    by: "LLM lane — AIGuard returns content_blocked: prompt_injection when the poisoned description reaches the model",
  },
  {
    n: 3,
    cardTone: "warn",
    chipTone: "warn",
    title: "Poisoned tool metadata",
    desc: "The <IMPORTANT> block in a description, or the off-box callback_url in a schema, arriving on tools/list.",
    tag: "Privilege can't see it",
    by: "it polices calls, not metadata → mcp-scanner catches it at ingest (proven live: 2 findings)",
  },
];

// Left to right: the agent talks to the gateway, the gateway to the hostile
// backend. Each hop is a lane Privilege enforces on.
const FLOW = [
  { role: "Client", name: "Agent", sub: "LibreChat · a real LLM" },
  { role: "Privilege", name: "Agent Privilege", sub: "app: libre · per-user policy", accent: true },
  { role: "Backend", name: "Hostile MCP", sub: "get_weather · search_docs · create_transfer" },
];
const LANES = [
  { label: "LLM lane", guard: "AIGuard" },
  { label: "MCP lane · tools/call", guard: "policy" },
];

// chip/chipTone: the outcome the step should show. "Expected" because this page runs nothing: the
// outcome is what you will see in LibreChat, not a verdict this page produced.
const STEPS = [
  { body: "In LibreChat, pick the privilege-libre MCP door and sign in as the demo user (the gateway runs the OAuth flow)." },
  { body: "Open tools/list — the poisoned get_weather and search_docs arrive with their payloads intact.", note: "the metadata poison already landed; the gateway never saw it" },
  { body: "Ask: “What's the weather in Denver?”", chip: "Expected: permit", chipTone: "ok", note: "an allowed tool call returns normally" },
  { body: "Ask: “Transfer $500 to external-001.” The poison induced this; the agent tries it.", chip: "Expected: deny", chipTone: "danger", note: "Privilege policy blocks the call at the gateway" },
  { body: "Run mcp-scanner against the server to show the earlier defense.", note: "flags hidden-instruction + exfil-sink before ingest" },
];

const FINDINGS = [
  { label: "get_weather", tone: "warn", chip: "Flagged", note: "hidden-instruction" },
  { label: "search_docs", tone: "warn", chip: "Flagged", note: "exfil-sink" },
  { label: "create_transfer", tone: "neutral", chip: "Not flagged", note: "a legit-looking action tool, no poisoned metadata" },
];

const REFERENCE = [
  { label: "Client URL (gateway)", value: "https://mcpgw.ai-demo.ping-devops.com/libre/mcp", mono: true },
  { label: "Backend (in-cluster)", value: "http://hostile-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse", mono: true },
  { label: "Mesh cluster", value: "ai-demo-cmuir", mono: true },
  { label: "Scan the server", value: "cd standalone/mcp-scanner && npm run scan -- <url>", mono: true },
  { label: "Confirm the deny", value: "kubectl logs -n ping-devops-curtismuir deploy/agentless-mcpgw -c log-tailer | grep 'policy denied'", mono: true },
];

export default function PrivilegeAiDemoPage() {
  const navigate = useNavigate();
  return (
    <PingPage className="pfa-page">
      <SimBanner data-testid="pfa-banner">
        <strong>STATIC LESSON</strong> — this page makes no live calls: nothing here reaches the gateway, PingOne,
        AIGuard or the scanner, and it simulates nothing either. The verdicts and the “2 findings” quoted below are what
        earlier runs of the demo showed; this page does not re-check them. To see them yourself, follow “Run the demo”
        in LibreChat, or open the MCP Scanner.
      </SimBanner>
      <LessonLayout
        title="Privilege for AI — Hostile MCP"
        subtitle="A deliberately hostile MCP server serves tools whose metadata carries the attack. Run it behind the Agent Privilege to show what the gateway defends — and the one thing it can't, which is why defense in depth matters."
        sections={SECTIONS}
        storageKey="pfa-lesson-nav-width"
      >
        <Section
          id="threats"
          kicker="1 · Threats"
          title="Three threats, three defenses"
          lede="Every AI-agent attack in this demo lands in one of three places. Privilege is the backstop for two of them; the third slips past it on purpose — that's the teaching moment."
        >
          <div className="pu-card-grid pfa-threat-grid">
            {THREATS.map((t) => (
              <Card key={t.n} tone={t.cardTone} title={`${t.n} · ${t.title}`} data-testid={`pfa-threat-${t.n}`}>
                <p className="pu-status-line"><StatusChip tone={t.chipTone}>{t.tag}</StatusChip></p>
                <p className="pu-note">{t.desc}</p>
                <p className="pu-note">{t.by}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section
          id="flow"
          kicker="2 · Defense in depth"
          title="Defense in depth, end to end"
          lede="The poison rides in on the tool list unfiltered. The gateway's job begins at the call; the scanner's job begins before the agent ever ingests the list."
        >
          <div className="pfa-flow-scroll" role="region" aria-label="Defense in depth diagram" tabIndex={0}>
            <div className="pfa-rail">
              {FLOW.map((node, i) => (
                <div className="pfa-rail-cell" key={node.name}>
                  <div className={`pfa-node${node.accent ? " pfa-node-accent" : ""}`}>
                    <div className="pfa-node-role">{node.role}</div>
                    <div className="pfa-node-name">{node.name}</div>
                    <div className="pfa-node-sub">{node.sub}</div>
                  </div>
                  {i < LANES.length && (
                    <div className="pfa-conn">
                      <div className="pfa-conn-lane">{LANES[i].label}</div>
                      <div className="pfa-conn-arrow" aria-hidden="true" />
                      <StatusChip tone="ok">{LANES[i].guard}</StatusChip>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Card tone="warn" title="The honest gap" data-testid="pfa-gap">
            <p className="pu-status-line"><StatusChip tone="warn">Privilege can&apos;t see it</StatusChip></p>
            <p className="pu-note">
              Discovery hands the poisoned descriptions and schemas to any client verbatim — the gateway has nothing to
              inspect metadata <em>with</em>. So <b>mcp-scanner</b> reads <code className="pu-mono">tools/list</code> and
              flags the injection and the exfil sink before the agent trusts them. The gateway stops the <em>action</em>;
              the scanner stops the <em>ingestion</em>.
            </p>
          </Card>
        </Section>

        <Section
          id="scanner"
          kicker="3 · Scanner"
          title="The blue-team scanner — catch it at ingest"
          lede={(
            <>
              Privilege stops the <em>action</em> (MCP lane) and the <em>content</em> (LLM lane), and its guardrail screens
              tool results and agent-to-agent messages, but it does not inspect the poisoned tool metadata itself. The
              scanner is that missing piece: it reads the server&apos;s <code className="pu-mono">tools/list</code> and
              flags the hidden instruction and the exfil sink before an agent ever trusts them — the same detection as{" "}
              <code className="pu-mono">standalone/mcp-scanner</code>, reporting never blocking.
            </>
          )}
        >
          <Card tone="neutral" title="Against the hostile server: 2 findings" data-testid="pfa-findings">
            <KvList
              items={FINDINGS.map((f) => ({
                label: f.label,
                value: (
                  <span className="pu-status-line">
                    <StatusChip tone={f.tone}>{f.chip}</StatusChip>
                    <span>{f.note}</span>
                  </span>
                ),
              }))}
            />
          </Card>
          <div className="pu-actions">
            <button
              type="button"
              className="pu-btn pu-btn--primary"
              data-testid="pfa-open-scanner"
              onClick={() => navigate("/mcp-scanner")}
            >
              Open the MCP Scanner and run it live
            </button>
          </div>
        </Section>

        <Section
          id="run"
          kicker="4 · Run it"
          title="Run the demo, step by step"
          lede="One browser sign-in, two prompts. The contrast between them is the whole show. The steps run in LibreChat and a terminal, not on this page."
        >
          <ol className="pfa-steps">
            {STEPS.map((s, i) => (
              <li className="pfa-step" key={s.body}>
                <span className="pfa-step-num" aria-hidden="true">{i + 1}</span>
                <Card tone={s.chipTone ?? "neutral"}>
                  <p className="pfa-step-text">{s.body}</p>
                  {(s.chip || s.note) && (
                    <p className="pu-status-line">
                      {s.chip && <StatusChip tone={s.chipTone}>{s.chip}</StatusChip>}
                      {s.note && <span>{s.note}</span>}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="reference" kicker="5 · Reference" title="Coordinates">
          <Card tone="neutral">
            <KvList items={REFERENCE} />
          </Card>
        </Section>
      </LessonLayout>
    </PingPage>
  );
}
