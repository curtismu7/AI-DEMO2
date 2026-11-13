// PrivilegeOwaspTop10Page.jsx
// Learner page for the OWASP Agentic AI Top 10 (ASI01–ASI10) and how PingOne
// Privilege covers each category — the "Privilege Capability Overview" deck's
// coverage table (page 21), expanded into a full explanation per category.
// Eight categories have full Privilege coverage (Gateway + AIGuard); two carry
// a stated gap, which is labelled as a gap rather than faked. Offline-safe:
// all content is static.
//
// Built on the shared Ping UI primitives (components/pingUi): P2 banner, P3
// frame, P4 cards, P5 kv, P7 chips. The one primary action is the link to the
// OWASP Agentic Security Initiative page.
import PageHeader from "./common/PageHeader";
import {Card, CardGrid, KvList,PageFrame, 
  PingPage, Section, SimBanner, StatusChip, 
} from "./pingUi";
import "./PrivilegeOwaspTop10Page.css";

const ASI_URL =
  "https://genai.owasp.org/initiatives/agentic-security-initiative-asi/";

// ASI01–ASI10, from the Privilege Capability Overview deck (2 Nov 2026, p.21).
// Each row: what the threat is (plain-language explanation), which Privilege
// component covers it (Gateway = the AI/agent gateway chokepoint; AIGuard =
// the prompt/content guardrail layer), how the coverage works today, and —
// for the two categories with a stated gap — the honest remainder.
const CATEGORIES = [
  {
    id: "ASI01",
    name: "Agent Goal Hijack",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "An attacker smuggles instructions into content the agent reads — a poisoned web page, a document, an email, a hidden prompt — and steers the agent away from its real goal. The agent obeys the attacker's goal instead of the user's, and may start calling tools toward it.",
    how: "Injection, jailbreak and hidden-instruction detection. AIGuard inspects prompts and retrieved content before the agent acts, so smuggled instructions are caught at the input boundary instead of becoming agent behaviour.",
    howShort: 'Injection, jailbreak and hidden-instruction detection',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI02",
    name: "Tool Misuse & Exploitation",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "The agent has powerful tools — file access, command execution, HTTP fetch — and a hijacked or confused agent turns them against the system: path traversal to read files it should not, destructive shell commands, SSRF to reach internal services, or calls beyond the scope it was granted.",
    how: "Path traversal, destructive command, SSRF and over-broad-scope rules. Requests to use a tool are evaluated against these rule classes before execution, so a poisoned agent cannot weaponise its toolset.",
    howShort: 'Path traversal, destructive commands, SSRF, over-broad scope',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI03",
    name: "Identity & Privilege Abuse",
    coveredBy: ["Gateway", "AIGuard"],
    tone: "ok",
    threat:
      "Agents act with credentials. If an agent holds a shared admin key, or keeps privileges after the task is done, a compromise becomes a privilege compromise: the attacker inherits everything the agent could do. This is the classic over-privileged service account problem, reborn for agents.",
    how: "Per-user virtual keys, least-privilege scopes, RBAC and live revocation. Every agent call is re-bound to the human it acts for and narrowed to the scopes that call needs; keys can be revoked the moment abuse is detected. Privilege's agent keys and non-human identity model exist for exactly this category.",
    howShort: 'Per-user virtual keys, least-privilege scopes, RBAC, live revocation',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI04",
    name: "Agentic Supply Chain",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "The agent's capabilities arrive from outside: MCP tool definitions, plugins, fetched packages. A malicious tool definition (instructions hidden in a tool's description) or a typosquatted tool name installs attacker behaviour into the agent before it ever runs.",
    how: "Tool-definition injection and typosquatting detection. Tool metadata is scanned before it reaches the agent. Fingerprint pinning — locking an agent to the exact tools it was built against — is the stated remaining gap.",
    howShort: 'Tool-definition injection and typosquatting',
    gap: "Fingerprint pinning is pending: today the gateway detects malicious tool definitions and typosquats, but does not yet pin a verified tool fingerprint per agent.",
    gapShort: 'fingerprint pinning pending',
  },
  {
    id: "ASI05",
    name: "Unexpected Code Execution",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "Model output or retrieved content contains executable payloads: shell metacharacters that break out of a command, template-injection syntax that escapes a template engine, or a fetch-and-execute chain that downloads and runs attacker code.",
    how: "Shell metacharacter, template-injection and fetch-and-execute rules. Code-shaped content is inspected before it is passed to anything that would execute it.",
    howShort: 'Shell metacharacter, template-injection and fetch-and-execute rules',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI06",
    name: "Memory & Context Poisoning",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "Agents persist what they learn. An attacker who plants a fact, preference or instruction into the agent's memory or context window changes every future decision the agent makes — a single write today becomes a standing backdoor across sessions.",
    how: "Memory-write inspection is shipped: content written into agent memory is inspected for poisoned instructions before it is stored.",
    howShort: 'Memory-write inspection shipped',
    gap: "Gateway integration is in progress: the memory-write inspection runs in AIGuard today; wiring the same inspection into the gateway path so all memory writes are covered is the remaining work.",
    gapShort: 'gateway integration in progress',
  },
  {
    id: "ASI07",
    name: "Insecure Inter-Agent Communication",
    coveredBy: ["Gateway", "AIGuard"],
    tone: "ok",
    threat:
      "Multi-agent systems talk to each other. Without authenticated, scoped channels, any agent (or anything pretending to be one) can inject messages, impersonate a peer, or escalate by asking a more privileged agent to do its dirty work.",
    how: "The gateway is the A2A chokepoint: agent-to-agent traffic passes through it with a dedicated inter-agent scope, so a peer cannot be reached out-of-band, and inter-agent abuse rules inspect what agents ask of each other.",
    howShort: 'A2A chokepoint with dedicated scope; inter-agent abuse rules',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI08",
    name: "Cascading Agent Failures",
    coveredBy: ["Gateway"],
    tone: "ok",
    threat:
      "Agents call agents call tools. One runaway or hallucinating agent can amplify through the chain — retry storms, cost blowouts, loops of tool calls — until a small failure becomes an outage or a runaway bill.",
    how: "Rate and budget ceilings, a circuit breaker, and an event stream to your SIEM. The gateway caps what any one agent can consume, cuts the circuit when a chain misbehaves, and streams the evidence to observability.",
    howShort: 'Rate and budget ceilings; circuit breaker; event stream to SIEM',
    gap: "ASI08 is met by real-time event data to your observability stack; in-gateway behaviour scoring supplements ASI08 and ASI10.",
  },
  {
    id: "ASI09",
    name: "Human-Agent Trust Exploitation",
    coveredBy: ["AIGuard"],
    tone: "ok",
    threat:
      "Humans trust their agents. An attacker exploits that trust: jailbreak the agent, make it leak its system prompt or other users' data, exfiltrate secrets through its outputs, or abuse the human's willingness to approve whatever the agent asks.",
    how: "Shared jailbreak, exfiltration, prompt-leak and PII rules. Outputs are inspected before they reach the human, so the agent cannot be turned into an exfiltration or leakage channel.",
    howShort: 'Shared jailbreak, exfiltration, prompt-leak and PII rules',
    gap: null,
    gapShort: null,
  },
  {
    id: "ASI10",
    name: "Rogue Agents",
    coveredBy: ["Gateway"],
    tone: "ok",
    threat:
      "Unregistered, unauthenticated or long-forgotten agents — shadow AI with a network connection. A rogue agent has no owner, no scope and no audit trail, and everything it touches is unaccountable.",
    how: "No agent reaches a model, tool or peer without a valid scoped key. The gateway simply refuses anything that cannot present one — registration through Privilege's agent registry is the only way onto the network.",
    howShort: 'No agent reaches a model, tool or peer without a valid scoped key',
    gap: null,
    gapShort: null,
  },
];

const fullCount = CATEGORIES.filter((c) => !c.gap).length;
const gapCount = CATEGORIES.filter((c) => c.gap).length;

export default function PrivilegeOwaspTop10Page() {
  return (
    <PingPage className="powasp-page" data-testid="privilege-owasp-top10-page">
      <SimBanner data-testid="powasp-banner">
        <strong>STATIC LESSON</strong> &mdash; this page explains the OWASP Agentic AI
        Top 10 categories and states how PingOne Privilege covers each one. The
        coverage wording is from the Privilege Capability Overview deck (2 Nov
        2026); the threat explanations are our own plain-language summaries and
        nothing here calls Privilege live or runs an attack.
      </SimBanner>
      <PageHeader
        eyebrow="Learn · Ping AI Products"
        title="OWASP Agentic AI Top 10 — Privilege coverage"
        summary={`All ten ASI categories, explained — and what Privilege does about each. ${fullCount} categories are fully covered today by the Privilege gateway and AIGuard; ${gapCount} carry a stated gap, labelled honestly rather than papered over.`}
        badge="OWASP ASI"
      />
      <PageFrame>
        <Section
          id="powasp-what-h"
          kicker="1 · The framework"
          title="What the Agentic AI Top 10 is"
          lede={
            <>
              The OWASP Agentic Security Initiative (ASI) publishes a Top 10 for
              agentic AI: the ten categories of risk that arise when software
              agents plan, remember, call tools and talk to each other. Where the
              classic LLM Top 10 covers model behaviour, ASI01&ndash;ASI10 cover{" "}
              <em>agency</em> — hijacked goals, abused tool access, agents
              impersonating agents, and cascading failures across chains. Each
              category below is paired with the Privilege capability that answers
              it, and the two categories with a stated gap say so explicitly.
            </>
          }
        >
          <CardGrid>
            <Card title="Coverage at a glance" data-testid="powasp-summary">
              <KvList
                items={[
                  { label: "Fully covered", value: `${fullCount} of 10 categories` },
                  { label: "Stated gap", value: "ASI04 (fingerprint pinning pending) · ASI06 (gateway integration in progress)" },
                  { label: "Covered by Gateway", value: "ASI03, ASI07, ASI08, ASI10" },
                  { label: "Covered by AIGuard", value: "ASI01, ASI02, ASI04, ASI05, ASI06, ASI09" },
                  { label: "Covered by both", value: "ASI03, ASI07" },
                  {
                    label: "Source",
                    value: (
                      <a href={ASI_URL} target="_blank" rel="noopener noreferrer">
                        OWASP Agentic Security Initiative
                      </a>
                    ),
                  },
                ]}
              />
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="powasp-table-h"
          kicker="2 · The coverage table"
          title="The deck's slide-21 coverage table"
          lede="The coverage table from the Privilege Capability Overview deck (page 21), reproduced as-is — the category cards below expand each row."
        >
          <div className="powasp-table-wrap">
            <table className="powasp-table" data-testid="powasp-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Threat</th>
                  <th scope="col">Covered by</th>
                  <th scope="col">How</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((c) => (
                  <tr key={c.id} data-testid={`powasp-row-${c.id.toLowerCase()}`}>
                    <td className="powasp-table-id">{c.id}</td>
                    <td className="powasp-table-threat">{c.name}</td>
                    <td className="powasp-table-by">
                      <span
                        className={`pu-chip ${c.gap ? "pu-chip--gap" : "pu-chip--full"}`}
                      >
                        {c.coveredBy.join(" + ")}
                      </span>
                    </td>
                    <td className={`powasp-table-how${c.gap ? " is-gap" : ""}`}>
                      {c.howShort}
                      {c.gap && <span className="powasp-table-gap">; {c.gapShort}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pu-note">
            ASI08 is met by real-time event data to your observability stack;
            in-gateway behaviour scoring supplements ASI08 and ASI10.
          </p>
        </Section>

        <Section
          id="powasp-categories-h"
          kicker="3 · The ten categories"
          title="ASI01–ASI10, explained with Privilege coverage"
          lede="Each card explains the threat in plain language, names the Privilege component that covers it, and describes how the coverage works. Cards marked with a gap chip carry the honest remainder."
        >
          <CardGrid>
            {CATEGORIES.map((c) => (
              <Card
                key={c.id}
                tone={c.gap ? "warn" : "ok"}
                title={`${c.id} · ${c.name}`}
                data-testid={`powasp-${c.id.toLowerCase()}`}
              >
                <p className="pu-status-line">
                  <StatusChip tone={c.gap ? "warn" : "ok"}>
                    {c.gap ? "Gap stated" : "Covered"}
                  </StatusChip>
                  <span className="powasp-covered-by">
                    {c.coveredBy.join(" + ")}
                  </span>
                </p>
                <p className="powasp-threat">{c.threat}</p>
                <p className="powasp-how">
                  <strong>How Privilege covers it:</strong> {c.how}
                </p>
                {c.gap && <p className="pu-note powasp-gap">{c.gap}</p>}
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section
          id="powasp-layers-h"
          kicker="4 · Two layers"
          title="Gateway and AIGuard, in one picture"
          lede="Privilege's coverage is split across two enforcement layers, and the categories make the division visible."
        >
          <CardGrid>
            <Card title="The Gateway (identity & chokepoint)">
              <p className="pu-note">
                The gateway sits between agents and everything they reach —
                models, tools, and peer agents. It enforces <em>who the agent
                is</em> and <em>what it may do</em>: per-user virtual keys
                (ASI03), the A2A chokepoint with a dedicated inter-agent scope
                (ASI07), rate and budget ceilings with a circuit breaker and
                SIEM event stream (ASI08), and the no-key-no-access rule that
                keeps rogue agents off the network (ASI10).
              </p>
            </Card>
            <Card title="AIGuard (content & behaviour)">
              <p className="pu-note">
                AIGuard inspects what flows through: prompts and retrieved
                content for injection and jailbreak (ASI01), tool-use requests
                against misuse rules (ASI02), tool definitions for supply-chain
                injection (ASI04), code-shaped payloads (ASI05), memory writes
                (ASI06), and outputs for exfiltration, prompt leakage and PII
                (ASI09).
              </p>
            </Card>
            <Card title="Where they overlap">
              <p className="pu-note">
                ASI03 (identity &amp; privilege abuse) and ASI07 (inter-agent
                communication) need both: the gateway proves identity and
                enforces scope on the hop, while AIGuard inspects the content
                of what the (now-proven) agent is asking for. ASI08's event
                stream and in-gateway behaviour scoring supplement ASI08 and
                ASI10 with runtime signal.
              </p>
            </Card>
          </CardGrid>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
