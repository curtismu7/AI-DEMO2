import { useMemo, useState } from "react";
import "./PrivilegeDocsIndexPage.css";

// The doc index from privilege/DOCUMENTATION-INDEX.md, as an in-app Learning
// Hub page. Sections mirror that file; the MD/PDF columns carry where each
// doc lives (repo path vs Google Drive folder).
const SECTIONS = [
  {
    id: "customer-deliverables",
    label: "Customer deliverables",
    docs: [
      {
        title: "Personal Agents at United",
        path: "docs/united/United-Personal-Agent-Security.md",
        covers:
          "MileagePlus members bringing their own agent (ChatGPT, coding CLIs, anything MCP-capable) and the security between: the no-BFF/no-DPoP architecture, gateway-fronted tool calls with minutes-long single-audience bearer tokens, United's as-built assistant, the gap analysis, and the recommended design. Working draft, 2026-10-09, prepared for United's AI team.",
      },
      {
        title: "United 431 Request Header Size Guidance",
        path: null,
        pdfInRepo: "docs/united/United 431 Request Header Size Guidance.pdf",
        covers:
          "Investigating and mitigating HTTP 431 “Request Header Fields Too Large” in United's browser-based headless Ping SDK / DaVinci flow on the custom domain: cookie-scope and intermediary causes, five remediation options, and the HAR-capture diagnostic sequence.",
      },
    ],
  },
  {
    id: "start",
    label: "Start here",
    docs: [
      {
        title: "Orientation & map",
        path: "privilege/README.md",
        covers:
          "One-screen orientation to the whole Privilege effort: the two deployment modes, where the code lives, what to read first.",
      },
      {
        title: "Canonical investigation record",
        path: "privilege/PRIVILEGE-MCP.md",
        covers:
          "Architecture, protocol on every hop, every blocker and how it was ruled out, dated newest-last. The trap list at the end of each section is what saves the time.",
      },
      {
        title: "Lessons learned",
        path: "privilege/LESSONS-LEARNED.md",
        covers:
          "Behaviors that cost real time and aren't in Ping's docs: policy union, entry-path pinning, DCR statelessness, hosted-vs-self-hosted auth. Read before authoring a policy or debugging a 403/404.",
      },
      {
        title: "Console steps",
        path: "privilege/PRIVILEGE-MCP-CONSOLE-STEPS.md",
        covers:
          "The console-side steps that cannot be automated or tested from the repo.",
      },
      {
        title: "Agentless configuration",
        path: "privilege/AGENTLESS-CONFIGURATION.md",
        covers:
          "Operating the live Agentless (OAuth/PKCE) gateway in ping-devops-cmuir: current source of truth for OAuth, routing and image values.",
      },
      {
        title: "Agent configuration",
        path: "privilege/AGENT-CONFIGURATION.md",
        covers:
          "Operating the Agent-authenticated OpenSearch deployment in ping-devops-curtismuir.",
      },
      {
        title: "Current configuration index",
        path: "privilege/CURRENT-CONFIGURATION.md",
        covers:
          "Choosing between Agentless and Agent modes, and comparing their current values side by side.",
      },
      {
        title: "Official Ping config reference",
        path: "privilege/PingOne-Privilege-MCP-Gateway-Configuration.md",
        pdf: true,
        covers:
          "Ping's own configuration checklist (received 2026-08-12). First doc to call out K8s ingress 443→8623 and the 8690 mesh port; the repo's K8s setup was audited against it.",
      },
      {
        title: "Technical summary v3",
        path: "privilege/MCP Privilege Gateway Technical Summary v3.pdf",
        pdfOnly: true,
        covers:
          "Ping's own summary of the MCP gateway feature. Ships as PDF only; v1/v2 exports remain outside the repo.",
      },
    ],
  },
  {
    id: "setup",
    label: "Gateway — setup & clients",
    docs: [
      {
        title: "Registering an MCP server",
        path: "privilege/GATEWAY-REGISTERING-AN-MCP-SERVER.md",
        pdf: true,
        tested: "2026-10-02",
        covers:
          "App fields, entry path, Auth Mode, policy — and what was tested live on the Agent Privilege.",
      },
      {
        title: "Sidecar MCP servers",
        path: "privilege/GATEWAY-SIDECAR-MCP-SERVERS.md",
        pdf: true,
        tested: "2026-10-02",
        covers:
          "Running an MCP server as a sidecar in the Agent Privilege pod: ports, secrets, registering, verifying.",
      },
      {
        title: "Connecting an MCP client",
        path: "privilege/GATEWAY-CONNECTING-AN-MCP-CLIENT.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "The app URL, discovery, self-registration, PKCE sign-in, tokens, client setup.",
      },
      {
        title: "Setting up a calling agent",
        path: "privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md",
        pdf: true,
        tested: "2026-10-03/04",
        covers:
          "Registering an agent that calls the gateway with a key: scopes, model limits, granting remote agents and tool servers, the custodian, runtime protection, refusals.",
      },
      {
        title: "Aggregate apps",
        path: "privilege/GATEWAY-AGGREGATE-APPS.md",
        pdf: true,
        tested: "2026-10-04",
        covers:
          "Many MCP servers behind one address: the <member>__<tool> prefix, granting tools, the two layers of access, the errors an aggregate returns.",
      },
      {
        title: "Load balancer & second gateway",
        path: "privilege/GATEWAY-LOAD-BALANCER.md",
        covers:
          "Two gateways as nodes of one mesh cluster: one app registration serves both, a shared token store, and the failover behavior after the fix.",
      },
      {
        title: "Building an agent the gateway can front",
        path: "privilege/GATEWAY-BUILDING-AN-AGENT-THE-GATEWAY-CAN-FRONT.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "The agent's side of A2A: the card, the JSON-RPC endpoint, which credential each auth mode delivers, refusing other paths, error codes, the direct door.",
      },
    ],
  },
  {
    id: "a2a",
    label: "Gateway — agent-to-agent (A2A)",
    docs: [
      {
        title: "Agent-to-agent (A2A)",
        path: "privilege/GATEWAY-AGENT-TO-AGENT-A2A.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "A2A direct and through the Agent Privilege: agent card, Remote Agent setup, calling agents and their keys, auth modes, Static Token, AIGuard and NeMo.",
      },
      {
        title: "A2A auth modes compared",
        path: "privilege/GATEWAY-A2A-AUTH-MODES-COMPARED.md",
        pdf: true,
        tested: "2026-10-03/04",
        covers:
          "None, Static Token, User Token and Pass Agent Token on a Remote Agent: what each delivers, which one the gateway refuses, how to choose and verify.",
      },
      {
        title: "Guardrails for A2A",
        path: "privilege/GATEWAY-GUARDRAILS-FOR-A2A.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "AIGuard on agent-to-agent calls: where it sits, the JSON-RPC block, which message parts are inspected, the a2a_request_* records, what is not covered.",
      },
    ],
  },
  {
    id: "ai-protection",
    label: "Gateway — AI protection",
    docs: [
      {
        title: "AIGuard (console walkthrough)",
        path: "privilege/GATEWAY-AIGUARD.md",
        covers:
          "The Add Agent wizard's Runtime Protection step: four detector groups and eleven detectors, Enable and Fail Closed, External Inspection and the ML Sidecar (console walkthrough with screenshots, 2026-10-08).",
      },
      {
        title: "Guardrails & the external detector",
        path: "privilege/GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "AIGuard on the model route: per-key detectors and thresholds, what a block looks like and its logs, the /inspect contract, Block Agreement, NeMo rails, what is and is not inspected.",
      },
      {
        title: "LLM routing & virtual keys",
        path: "privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "The /llm/<provider>/v1 route and virtual keys: key settings, order of checks, allowed models, rate limits, refusals, the LLM request log line.",
      },
      {
        title: "LLM protection in the demo stack",
        path: "docs/privilege-llm-protection.md",
        covers:
          "How LLM protection is wired into the AI-DEMO2 BFF: secrets into ai-demo-secrets, gateway route, what the demo shows.",
      },
    ],
  },
  {
    id: "observability",
    label: "Gateway — observability",
    docs: [
      {
        title: "Logging with Elasticsearch",
        path: "privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "What reaches Elasticsearch (console audit events only), where model calls and guardrail verdicts are recorded, shipping them, Kibana searches, the secrets both feeds contain.",
      },
      {
        title: "Reading gateway errors",
        path: "privilege/GATEWAY-READING-GATEWAY-ERRORS.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "What each status code can mean, the log lines behind it, tracing one request, backend and guardrail errors.",
      },
      {
        title: "Elasticsearch & Kibana runbook",
        path: "docs/privilege-elasticsearch-kibana-runbook.md",
        covers:
          "Sending Privilege SIEM events to Elasticsearch and viewing them in Kibana, using Kibana's port-forward as the endpoint.",
      },
    ],
  },
  {
    id: "sensor",
    label: "Sensor",
    docs: [
      {
        title: "Sensor on Docker (guide)",
        path: "privilege/SENSOR-DOCKER-GUIDE.md",
        pdf: true,
        covers:
          "The Privilege node sensor on any Docker host: setup, how it works, identity, logging, failure modes.",
      },
      {
        title: "Sensor on Docker (our environment)",
        path: "privilege/SENSOR-DOCKER-OUR-ENVIRONMENT.md",
        pdf: true,
        covers:
          "Our Docker→local-gateway→Docker loop, our values, and the 2026-10-01 sensor failure and fix.",
      },
      {
        title: "Sensor on Kubernetes (guide)",
        path: "privilege/SENSOR-KUBERNETES-GUIDE.md",
        pdf: true,
        covers:
          "The sensor on any Kubernetes cluster: Helm install, ServiceAccount-token identity, chart values.",
      },
      {
        title: "Sensor on Kubernetes (our environment)",
        path: "privilege/SENSOR-KUBERNETES-OUR-ENVIRONMENT.md",
        pdf: true,
        covers:
          "Our values, how k8s/deploy.sh installs the sensor, open questions.",
      },
      {
        title: "Sensor enforcement policies",
        path: "privilege/SENSOR-ENFORCEMENT-POLICIES.md",
        pdf: true,
        tested: "2026-10-03",
        covers:
          "How a policy reaches the sensor, off/audit/enforce, what a rule contains, scope, what termination looks like, the tier, and a safe local test.",
      },
    ],
  },
  {
    id: "secrets-hub",
    label: "Secrets Hub",
    docs: [
      {
        title: "Secrets Hub with Google Secret Manager",
        path: "privilege/SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md",
        pdf: true,
        tested: "2026-10-04",
        covers:
          "Connecting GSM as a Privilege Secrets Hub: project setup, the API the form leaves out, what sync and view read, policies, and the service-account key landing in the audit log.",
      },
    ],
  },
  {
    id: "demos",
    label: "Demos & environments",
    docs: [
      {
        title: "A2A demo & setup",
        path: "privilege/A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md",
        pdf: true,
        covers:
          "Runbook for both A2A demos through the Agent Privilege: the pre-demo check, both demo scripts with what to say, setup from scratch with our values, symptom-to-fix table and known limits.",
      },
      {
        title: "New demo environment",
        path: "privilege/NEW-DEMO-ENVIRONMENT.md",
        covers:
          "A separate demo environment from scratch (own PingOne env, gateway, apps, agents): parameter table, what is verified, enrolling with the right Host IP, token and CPU traps, order of steps.",
      },
      {
        title: "Deploying & upgrading on Kubernetes",
        path: "privilege/PRIVILEGE-K8S-DEPLOY-UPGRADE.md",
        pdf: true,
        covers:
          "Helm install/upgrade/re-enroll/teardown of an Agentless gateway: first-install sequence, the Host-IP and token-whitespace traps, extraContainers and floating-tag upgrade rules, the PV-destruction teardown deadlock, and what is verified vs from notes (2026-10-09).",
      },
      {
        title: "Running the gateway locally (Docker)",
        path: "privilege/GATEWAY-LOCAL-DOCKER.md",
        pdf: true,
        covers:
          "The profile: mcpgw compose stack: start/stop, enrollment token + pingone.env + /etc/hosts + console app, the post-swap port map (settle by probing), nginx front door, verification incl. the smoke script, and the CA-wall status of the currently stopped local gateway (2026-10-09).",
      },
      {
        title: "Workload identity for agent callers",
        path: "privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md",
        pdf: true,
        covers:
          "What Pass Agent Token demands (token-pass), the SPIFFE→PingFederate actor-token path verified live 2026-09-26, and the documented gap: no caller has yet presented a workload token to the gateway, with the experiment that would close it (2026-10-09).",
      },
      {
        title: "SE1 shared demo",
        path: "privilege/SE1-Privilege-Shared-Demo.md",
        covers:
          "Setting up the shared Privilege demo in the SE1 environment.",
      },
      {
        title: "Privilege Agent setup — Mac",
        path: "privilege/SE1-Privilege-Agent-Setup-Mac.md",
        covers:
          "Agent-based persona onboarding for the shared Demo Engineering environment, run on your own Mac instead of Windows 11 VMs.",
      },
      {
        title: "Demo script & setup",
        path: "privilege/demo/privilege-demo-script.md",
        covers:
          "The customer-facing demo script and setup (auto-generated from the use-case docs — do not hand-edit).",
      },
      {
        title: "CIMD client documents",
        path: "docs/2026-10-07-cimd-privilege-client-documents.md",
        pdf: true,
        covers:
          "CIMD (client metadata documents) for PingOne Privilege — flow, boundary, and client documents, with diagrams.",
      },
      {
        title: "MCP discovery-gating demo",
        path: "privilege/MCP-DISCOVERY-DEMO.md",
        pdf: true,
        covers:
          "SE demo script: an agent's tools/list returns only what its policy grants — permit door, deny-by-default door, grant change, agent key, aggregate; pre-demo check and troubleshooting (every claim measured 2026-10-02…04).",
      },
    ],
  },
  {
    id: "reference",
    label: "Reference & records",
    docs: [
      {
        title: "OpenAPI MCP on Kubernetes",
        path: "privilege/OPENAPI-KUBERNETES-WORKING-PATTERN-2026-10-01.md",
        covers:
          "Working patterns for OpenAPI-based MCP on Kubernetes and the remaining gap (2026-10-01, updated 2026-10-03).",
      },
      {
        title: "Fix Privilege MCP guide — status",
        path: "docs/privilege-mcp-guide-status.md",
        covers:
          "Status split from the raw punch list of the ai-demo.ping-devops.com guide fix; original numbering kept for traceability.",
      },
      {
        title: "Status snapshot 2026-08-02",
        path: "privilege/PRIVILEGE-MCP-STATUS-2026-08-02.md",
        covers:
          "Point-in-time snapshot, superseded by the canonical record. Kept as historical evidence only.",
      },
      {
        title: "Ping decks & exports",
        path: null,
        pdf: true,
        covers:
          "Ping-provided decks and older exports: Privilege-AIGuard, Privilege-AI-Gateway, Privilege+Shared Demo, Instructional Demo Setup (Confluence export + SE1), Technical Summary v1/v2.",
      },
      {
        title: "SE enablement storyboards",
        path: null,
        covers:
          "Ping's SE storyboards (HTML, ~13 MB of embedded images, not committed): architecture, flows, troubleshooting order. The older deck's EvaluateHost routing model is disproven on build v1.260726.",
      },
    ],
  },
];

const PLANNED = [
  ["Red team: a hostile A2A agent", "A poisoned agent card and what Inter-Agent Abuse detection catches", "Partly — hostile agent needs registering"],
  ["Ping's reference demo, explained", "The two-agent demo (main agent, worker agent, MCP server) wired through the gateway", "Partly — needs the demo running"],
  ["Policies in depth", "Expiry, several policies adding up, groups, per-tool grants", "Partly — needs console changes"],
  ["Auth modes for MCP backends", "None, Static Token, User Token, OAuth, Pass Agent Token", "Partly — needs console changes"],
  ["Agent mode end to end", "The Privilege Agent on a workstation, device-bound identity, how it differs from agentless", "Partly — needs the agent paired on a Mac"],
];

const GITHUB_BASE = "https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/";
const DRIVE_NOTE =
  "PDF exports of the SE guides ship through the shared Google Drive folder.";
const ASSETS_NOTE = [
  "privilege/design/",
  "privilege/diagrams/",
  "privilege/postman/",
  "privilege/runbooks/",
  ".claude/skills/privilege-*",
];

export default function PrivilegeDocsIndexPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      docs: section.docs.filter((doc) =>
        [section.label, doc.title, doc.covers, doc.path || ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      ),
    })).filter((section) => section.docs.length > 0);
  }, [query]);

  const totalDocs = SECTIONS.reduce((sum, s) => sum + s.docs.length, 0);

  return (
    <div className="pdi-page">
      <header className="pdi-header">
        <div className="pdi-header-inner">
          <p className="pdi-eyebrow">Learning Hub · Ping AI Products</p>
          <h1>Privilege documentation index</h1>
          <p className="pdi-sub">
            Every Privilege doc we own, in one place — {totalDocs} documents
            across {SECTIONS.length} sections, with planned guides at the end.
            The MD link is the source file in the public repo; {DRIVE_NOTE}
          </p>
        </div>
      </header>

      <div className="pdi-body">
        <form
          className="pdi-search"
          onSubmit={(e) => e.preventDefault()}
          role="search"
        >
          <label htmlFor="pdi-query" className="pdi-visually-hidden">
            Search the Privilege documentation index
          </label>
          <input
            id="pdi-query"
            type="search"
            placeholder="Filter by title, topic, or file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        {filtered.length === 0 && (
          <p className="pdi-empty" role="status">
            No documents match “{query}”.
          </p>
        )}

        {filtered.map((section) => (
          <section key={section.id} className="pdi-section" aria-label={section.label}>
            <h2>
              {section.label}
              <span className="pdi-count">{section.docs.length}</span>
            </h2>
            <div className="pdi-tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">PDF</th>
                    <th scope="col">What it covers</th>
                  </tr>
                </thead>
                <tbody>
                  {section.docs.map((doc) => (
                    <tr key={doc.title}>
                      <th scope="row">
                        {doc.path ? (
                          <a
                            href={`${GITHUB_BASE}${encodeURIComponent(
                              doc.path,
                            ).replaceAll("%2F", "/")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {doc.title}
                          </a>
                        ) : (
                          doc.title
                        )}
                        <code className="pdi-fname">{doc.path || "—"}</code>
                      </th>
                      <td>
                        {doc.pdfOnly ? (
                          <a
                            href={`${GITHUB_BASE}${encodeURIComponent(
                              doc.path,
                            ).replaceAll("%2F", "/")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            in repo
                          </a>
                        ) : doc.pdf ? (
                          "Drive (SE)"
                        ) : (
                          <span className="pdi-none">—</span>
                        )}
                      </td>
                      <td>{doc.covers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <section className="pdi-section" aria-label="Assets in the repo">
          <h2>Assets in the repo</h2>
          <p className="pdi-planned-note">
            Non-document assets living alongside the guides:{" "}
            {ASSETS_NOTE.map((path) => (
              <code key={path}>{path}</code>
            )).reduce((prev, curr, i) => (
              <span key={ASSETS_NOTE[i]}>
                {i > 0 && " · "}
                {curr}
              </span>
            ))}
            . The diagrams folder holds the Agentic Trust Control Plane slide
            (Agent Privilege = discover &amp; register, steps 2–5 IAM Core / AI
            Gateway / Agent Authorize / Agent Governance) and four rendered MCP
            flows.
          </p>
        </section>

        <section className="pdi-section" aria-label="Planned guides">
          <h2>
            Planned
            <span className="pdi-count">{PLANNED.length}</span>
          </h2>
          <p className="pdi-planned-note">
            From <code>privilege/privilege-docs-to-create.md</code>. “Testable
            now” means every claim can be checked against a live system today.
          </p>
          <div className="pdi-tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Guide</th>
                  <th scope="col">What it covers</th>
                  <th scope="col">Testable now?</th>
                </tr>
              </thead>
              <tbody>
                {PLANNED.map(([title, covers, testable]) => (
                  <tr key={title}>
                    <th scope="row">{title}</th>
                    <td>{covers}</td>
                    <td>{testable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
