import { useMemo, useState } from "react";
import "./PrivilegeDocsIndexPage.css";

// The canonical Privilege docs index (privilege/DOCUMENTATION-INDEX.md),
// Drive-first: every link points at the shared Google Drive folder so no Ping
// GitHub access is needed. The repo path under each title stays as the
// maintainer reference — sources live in AI-DEMO2. Ported from the
// Confluence-source HTML (Documents/Privilege Sensor Docs/); counts are
// computed from this data, never hardcoded.
const DRIVE_FOLDER =
  "https://drive.google.com/drive/u/0/folders/13SG0IDSMTkGyQTJd6NTdG7KTEh3Aw4Nd";

const drive = (id) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;

const SECTIONS = [
  {
    id: "customer",
    label: "Customer deliverables",
    docs: [
      {
        title: "On users' personal agent design",
        drive: drive("1RSLH0KBchNb1dXXMIknnT5YrDrS2Az6l"),
        repo: "docs/personal-agent/On-Users-Personal-Agent-Design.md",
        pdf: "repo",
        covers:
          "The personal-agent security architecture, built on an airline loyalty-program review: members bringing their own agent (ChatGPT, coding CLIs, anything MCP-capable) and the security between — the no-BFF/no-DPoP architecture, gateway-fronted tool calls with minutes-long single-audience bearer tokens, the as-built assistant, the gap analysis, and the recommended design. Top of page maps the design to Agent Privilege and links the demo surfaces and diagrams. Working draft, 2026-10-09, prepared for the customer's AI team.",
      },
      {
        title: "Request Header Size (HTTP 431) Guidance",
        drive: drive("1SAxqFy96HcXVi_iP-CbQII-UU5XEsfBS"),
        repo: "docs/personal-agent/Request-Header-Size-431-Guidance.pdf",
        pdf: "repo",
        covers:
          'Investigating and mitigating HTTP 431 "Request Header Fields Too Large" in a browser-based headless Ping SDK / DaVinci flow on a custom domain: cookie-scope and intermediary causes, five remediation options (BFF/proxy, cookie scope, credentialed-request limits, intermediary stripping, eTLD+1 domain), and the HAR-capture diagnostic sequence.',
      },
    ],
  },
  {
    id: "start",
    label: "Start here",
    docs: [
      {
        title: "Orientation & map",
        drive: DRIVE_FOLDER,
        repo: "privilege/README.md",
        pdf: null,
        covers:
          "One-screen orientation to the whole Privilege effort: the two deployment modes, where the code lives, what to read first.",
      },
      {
        title: "Canonical investigation record",
        drive: drive("1Dd8ZdNNiPtLDENBV5Hl7Ye_ApwrMkm-L"),
        repo: "privilege/PRIVILEGE-MCP.md",
        pdf: null,
        covers:
          "Architecture, protocol on every hop, every blocker and how it was ruled out, dated newest-last. The trap list at the end of each section is what saves the time.",
      },
      {
        title: "Lessons learned",
        drive: drive("1ifXedMnNGj6pBZyBh3Q5bHKhLT2jwF6I"),
        repo: "privilege/LESSONS-LEARNED.md",
        pdf: null,
        covers:
          "Behaviors that cost real time and aren't in Ping's docs: policy union, entry-path pinning, DCR statelessness, hosted-vs-self-hosted auth. Read before authoring a policy or debugging a 403/404.",
      },
      {
        title: "Console steps",
        drive: DRIVE_FOLDER,
        repo: "privilege/PRIVILEGE-MCP-CONSOLE-STEPS.md",
        pdf: null,
        covers:
          "The console-side steps that cannot be automated or tested from the repo.",
      },
      {
        title: "Agentless configuration",
        drive: DRIVE_FOLDER,
        repo: "privilege/AGENTLESS-CONFIGURATION.md",
        pdf: null,
        covers:
          "Operating the live Agentless (OAuth/PKCE) gateway in ping-devops-cmuir: current source of truth for OAuth, routing and image values.",
      },
      {
        title: "Agent configuration",
        drive: drive("1iw6T87jgJXEOKmvcbvpa-ajErNVk_o4f"),
        repo: "privilege/AGENT-CONFIGURATION.md",
        pdf: null,
        covers:
          "⚠ Stale-bannered 2026-10-10: describes the removed cm-mcpgw deployment — kept for the console-side operating method. Current state in",
        coversLink: {
          label: "Agent mode end to end",
          href: drive("10oribAOVkel4dH7wsE8XQWN0XZUCk9xL"),
        },
      },
      {
        title: "Current configuration index",
        drive: DRIVE_FOLDER,
        repo: "privilege/CURRENT-CONFIGURATION.md",
        pdf: null,
        covers:
          "Choosing between Agentless and Agent modes, and comparing their current values side by side.",
      },
      {
        title: "Tag policies in depth",
        drive: DRIVE_FOLDER,
        repo: "privilege/TAG-POLICIES.md",
        pdf: null,
        covers:
          "What tag policies are and what they are not: name-regex → tag-set rules that do NOT auto-tag (measured), the CTags PUT that actually applies tags, per-resource quirks (namespaced agent-key PUT, MCP-app display bug), and the live demo-map-* set with its maintenance rule.",
      },
      {
        title: "Official Ping config reference",
        drive: DRIVE_FOLDER,
        repo: "privilege/PingOne-Privilege-MCP-Gateway-Configuration.md",
        pdf: "drive",
        covers:
          "Ping's own configuration checklist (received 2026-08-12). First doc to call out K8s ingress 443→8623 and the 8690 mesh port; the repo's K8s setup was audited against it.",
      },
      {
        title: "Technical summary v3",
        drive: DRIVE_FOLDER,
        repo: "privilege/MCP Privilege Gateway Technical Summary v3.pdf",
        pdf: "repo",
        covers:
          "Ping's own summary of the MCP gateway feature. PDF only; v1/v2 exports remain outside the repo.",
      },
    ],
  },
  {
    id: "gw-setup",
    label: "Gateway — setup & clients",
    docs: [
      {
        title: "Registering an MCP server",
        drive: drive("1Xm-OD0VwI3T6g8-1Si8fybOkGX5SODyC"),
        repo: "privilege/GATEWAY-REGISTERING-AN-MCP-SERVER.md",
        pdf: "drive",
        covers:
          "App fields, entry path, Auth Mode, policy — and what was tested live on the Agent Privilege (2026-10-02).",
      },
      {
        title: "Sidecar MCP servers",
        drive: drive("1_QYrvIIJJ4eTwB83LWhY3F9KsFwurPdd"),
        repo: "privilege/GATEWAY-SIDECAR-MCP-SERVERS.md",
        pdf: "drive",
        covers:
          "Running an MCP server as a sidecar in the Agent Privilege pod: ports, secrets, registering, verifying (tested live 2026-10-02).",
      },
      {
        title: "Connecting an MCP client",
        drive: drive("1eA4Z473bFZJ8iygCOoURI9YpIdZKAKoR"),
        repo: "privilege/GATEWAY-CONNECTING-AN-MCP-CLIENT.md",
        pdf: "drive",
        covers:
          "The app URL, discovery, self-registration, PKCE sign-in, tokens, client setup (tested live 2026-10-03).",
      },
      {
        title: "Setting up a calling agent",
        drive: drive("1KZYzmQwWbRIcRbZVUug6cDuSR74hB8qS"),
        repo: "privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md",
        pdf: "drive",
        covers:
          "Registering an agent that calls the gateway with a key: scopes, model limits, granting remote agents and tool servers, the custodian, runtime protection, refusals (tested live 2026-10-03/04).",
      },
      {
        title: "Aggregate apps",
        drive: drive("1WaL9IxvSQwYJFHtw8BTkbxtw1mwh3sVQ"),
        repo: "privilege/GATEWAY-AGGREGATE-APPS.md",
        pdf: "drive",
        covers:
          "Many MCP servers behind one address: the <member>__<tool> prefix, granting tools, the two layers of access, the errors an aggregate returns (tested live 2026-10-04).",
      },
      {
        title: "Load balancer & second gateway",
        drive: DRIVE_FOLDER,
        repo: "privilege/GATEWAY-LOAD-BALANCER.md",
        pdf: null,
        covers:
          "Two gateways as nodes of one mesh cluster: one app registration serves both, a shared token store, and the failover behavior after the fix.",
      },
      {
        title: "Building an agent the gateway can front",
        drive: drive("1v4pxJG0cvVsD1VH5juabtdtR-bxELAb6"),
        repo: "privilege/GATEWAY-BUILDING-AN-AGENT-THE-GATEWAY-CAN-FRONT.md",
        pdf: "drive",
        covers:
          "The agent's side of A2A: the card, the JSON-RPC endpoint, which credential each auth mode delivers, refusing other paths, error codes, the direct door (tested live 2026-10-03).",
      },
    ],
  },
  {
    id: "gw-a2a",
    label: "Gateway — agent-to-agent (A2A)",
    docs: [
      {
        title: "Agent-to-agent (A2A)",
        drive: drive("1VC5izsf-iLCPp4p_vXvx80AUZNQkaRh2"),
        repo: "privilege/GATEWAY-AGENT-TO-AGENT-A2A.md",
        pdf: "drive",
        covers:
          "A2A direct and through the Agent Privilege: agent card, Remote Agent setup, calling agents and their keys, auth modes, Static Token, AIGuard and NeMo (tested live 2026-10-03).",
      },
      {
        title: "A2A auth modes compared",
        drive: drive("1FcrPXlMxyYAzZO-KZpq7DAiu1eU98o4c"),
        repo: "privilege/GATEWAY-A2A-AUTH-MODES-COMPARED.md",
        pdf: "drive",
        covers:
          "None, Static Token, User Token and Pass Agent Token on a Remote Agent: what each delivers, which one the gateway refuses, how to choose and verify (tested live 2026-10-03/04).",
      },
      {
        title: "Guardrails for A2A",
        drive: drive("1TjsyKa7JnVkzYL5KbMmyw1T2HHEs5WNQ"),
        repo: "privilege/GATEWAY-GUARDRAILS-FOR-A2A.md",
        pdf: "drive",
        covers:
          "AIGuard on agent-to-agent calls: where it sits, the JSON-RPC block, which message parts are inspected, the a2a_request_* records, what is not covered (tested live 2026-10-03).",
      },
    ],
  },
  {
    id: "gw-ai",
    label: "Gateway — AI protection",
    docs: [
      {
        title: "AIGuard (console walkthrough)",
        drive: DRIVE_FOLDER,
        repo: "privilege/GATEWAY-AIGUARD.md",
        pdf: null,
        covers:
          "The Add Agent wizard's Runtime Protection step: four detector groups and eleven detectors, Enable and Fail Closed, External Inspection and the ML Sidecar (console walkthrough with screenshots, 2026-10-08).",
      },
      {
        title: "Guardrails & the external detector",
        drive: drive("17GuTgR5a6Bj8P9VzINmL0zyExLmuP7SJ"),
        repo: "privilege/GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md",
        pdf: "drive",
        covers:
          "AIGuard on the model route: per-key detectors and thresholds, what a block looks like and its logs, the /inspect contract, Block Agreement, NeMo rails, what is and is not inspected (tested live 2026-10-03).",
      },
      {
        title: "LLM routing & virtual keys",
        drive: drive("1LUig8J6_eSWgmWyCHTUiGy6tURCuoU_F"),
        repo: "privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md",
        pdf: "drive",
        covers:
          "The /llm/<provider>/v1 route and virtual keys: key settings, order of checks, allowed models, rate limits, refusals, the LLM request log line (tested live 2026-10-03).",
      },
      {
        title: "LLM protection in the demo stack",
        drive: drive("1ZN6EB9wxJEBwabBkcCP3domapKPyxXO-"),
        repo: "docs/privilege-llm-protection.md",
        pdf: null,
        covers:
          "How LLM protection is wired into the AI-DEMO2 BFF: secrets into ai-demo-secrets, gateway route, what the demo shows.",
      },
    ],
  },
  {
    id: "gw-obs",
    label: "Gateway — observability",
    docs: [
      {
        title: "Logging with Elasticsearch",
        drive: drive("1yi8RZnzfJdZIKZgqPsDTFxOOW-oSj_sP"),
        repo: "privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md",
        pdf: "drive",
        covers:
          "What reaches Elasticsearch (console audit events only), where model calls and guardrail verdicts are recorded, shipping them, Kibana searches, the secrets both feeds contain (read live 2026-10-03).",
      },
      {
        title: "Reading gateway errors",
        drive: drive("1WdZIqT0_QGSZ2rujQlh-wCK-dio7w5li"),
        repo: "privilege/GATEWAY-READING-GATEWAY-ERRORS.md",
        pdf: "drive",
        covers:
          "What each status code can mean, the log lines behind it, tracing one request, backend and guardrail errors (reproduced live 2026-10-03).",
      },
      {
        title: "Elasticsearch & Kibana runbook",
        drive: drive("15G8yCS61W9ZC-MdBHpRprnYG9WpZx4mQ"),
        repo: "docs/privilege-elasticsearch-kibana-runbook.md",
        pdf: null,
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
        drive: drive("1cdcGS8uFbT0j7wegByq5uDlp-qk0xr8R"),
        repo: "privilege/SENSOR-DOCKER-GUIDE.md",
        pdf: "drive",
        covers:
          "The Privilege node sensor on any Docker host: setup, how it works, identity, logging, failure modes.",
      },
      {
        title: "Sensor on Docker (our environment)",
        drive: drive("15zgRZJL74ms_xn644HQsIrCErLqt3gmy"),
        repo: "privilege/SENSOR-DOCKER-OUR-ENVIRONMENT.md",
        pdf: "drive",
        covers:
          "Our Docker→local-gateway→Docker loop, our values, and the 2026-10-01 sensor failure and fix.",
      },
      {
        title: "Sensor on Kubernetes (guide)",
        drive: drive("15fmUP31U3SiQZZC_pYNcZ2si0pdLxyrS"),
        repo: "privilege/SENSOR-KUBERNETES-GUIDE.md",
        pdf: "drive",
        covers:
          "The sensor on any Kubernetes cluster: Helm install, ServiceAccount-token identity, chart values.",
      },
      {
        title: "Sensor on Kubernetes (our environment)",
        drive: drive("1-qMdsmDoyC6G-Np3-yktMvwGqJXkvXP6"),
        repo: "privilege/SENSOR-KUBERNETES-OUR-ENVIRONMENT.md",
        pdf: "drive",
        covers:
          "Our values, how k8s/deploy.sh installs the sensor, open questions.",
      },
      {
        title: "Sensor enforcement policies",
        drive: drive("18X6Um5umVvhBLOk3h-s5luolcA3Wg4OL"),
        repo: "privilege/SENSOR-ENFORCEMENT-POLICIES.md",
        pdf: "drive",
        covers:
          "How a policy reaches the sensor, off/audit/enforce, what a rule contains, scope, what termination looks like, the tier, and a safe local test (tested live 2026-10-03).",
      },
    ],
  },
  {
    id: "secrets",
    label: "Secrets Hub",
    docs: [
      {
        title: "Secrets Hub with Google Secret Manager",
        drive: drive("1p6rokSWgf99Yff_FvS9GeegAXNgIUkkj"),
        repo: "privilege/SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md",
        pdf: "drive",
        covers:
          "Connecting GSM as a Privilege Secrets Hub: project setup, the API the form leaves out, what sync and view read, policies, and the service-account key landing in the audit log (tested live 2026-10-04).",
      },
    ],
  },
  {
    id: "demos",
    label: "Demos & environments",
    docs: [
      {
        title: "A2A demo & setup",
        drive: drive("15cp1HVZIG9ujHDJIk1MvQcQOe-dHAm2A"),
        repo: "privilege/A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md",
        pdf: "drive",
        covers:
          "Runbook for both A2A demos through the Agent Privilege: the pre-demo check, both demo scripts with what to say, setup from scratch with our values, symptom-to-fix table and known limits.",
      },
      {
        title: "New demo environment",
        drive: drive("1rDb09nO8qnQN9tu6C-29iWUiazDSjqpm"),
        repo: "privilege/NEW-DEMO-ENVIRONMENT.md",
        pdf: null,
        covers:
          "A separate demo environment from scratch (own PingOne env, gateway, apps, agents): parameter table, what is verified, enrolling with the right Host IP, token and CPU traps, order of steps.",
      },
      {
        title: "Deploying & upgrading on Kubernetes",
        drive: drive("1GFHF00TIkAXqr72kLUAxQNUNvBpTr0A4"),
        repo: "privilege/PRIVILEGE-K8S-DEPLOY-UPGRADE.md",
        pdf: "drive",
        covers:
          "Helm install/upgrade/re-enroll/teardown of an Agentless gateway: first-install sequence, the Host-IP and token-whitespace traps, extraContainers and floating-tag upgrade rules, the PV-destruction teardown deadlock, and what is verified vs from notes (2026-10-09).",
      },
      {
        title: "Running the gateway locally (Docker)",
        drive: drive("1RbgXksFZT2_D64KdsPt_8vZswAo7duTi"),
        repo: "privilege/GATEWAY-LOCAL-DOCKER.md",
        pdf: "drive",
        covers:
          "The profile: mcpgw compose stack: start/stop, enrollment token + pingone.env + /etc/hosts + console app, the post-swap port map (settle by probing), nginx front door, verification incl. the smoke script, and the CA-wall status of the currently stopped local gateway (2026-10-09).",
      },
      {
        title: "Workload identity for agent callers",
        drive: drive("1jRXKjKSORGx8UW1Cr7rleoFit3Ry8TVc"),
        repo: "privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md",
        pdf: "drive",
        covers:
          "What Pass Agent Token demands (token-pass), the SPIFFE→PingFederate actor-token path verified live 2026-09-26, and the documented gap: no caller has yet presented a workload token to the gateway, with the experiment that would close it (2026-10-09).",
      },
      {
        title: "Red team: a hostile A2A agent",
        drive: drive("1zk0pk9AVLTMXxcNtB9sRd1Ak4Qu5j6DQ"),
        repo: "privilege/RED-TEAM-HOSTILE-A2A.md",
        pdf: "drive",
        covers:
          "The poisoned-Agent-Card attack end to end: standalone/hostile-a2a-agent, the deployed instance, what the gateway blocked vs alerted vs passed (measured 2026-10-03/06), the three properties of an A2A block, and what the demo does not claim (2026-10-09).",
      },
      {
        title: "Auth modes for MCP backends",
        drive: drive("1SoRX0SBAOSTUH1n5yesnqAp0mZREJNBd"),
        repo: "privilege/AUTH-MODES-MCP-BACKENDS.md",
        pdf: "drive",
        covers:
          "What each mode sends the backend (None, Static Token, User Token, Pass Agent Token, OAuth), the header pass-through + X-Procyon-Mcp-Cap behavior, the verified instances in this stack, the OAuth warning (breaks discovery on v1.260906), and a choosing guide (2026-10-09).",
      },
      {
        title: "SE1 shared demo",
        drive: drive("1ZBNDYhXYcF1VE03Qppmf1rOtxuxvLo6e"),
        repo: "privilege/SE1-Privilege-Shared-Demo.md",
        pdf: null,
        covers:
          "Setting up the shared Privilege demo in the SE1 environment.",
      },
      {
        title: "Running our demo on the shared env",
        drive: DRIVE_FOLDER,
        repo: "privilege/RUNNING-OUR-DEMO-ON-THE-SHARED-ENV.md",
        pdf: null,
        covers:
          "Gap analysis for pointing our stack (UC45–47, LLM virtual keys, the MCP-client door) at the shared SE1 environment: what breaks and why, what we would add there, the 15-minute console probe for the open gateway question, and how to read each outcome (2026-10-11).",
      },
      {
        title: "Privilege Agent setup — Mac",
        drive: drive("1gP3ZKhmMjd7MPotVihDLzYhHV1SqysPn"),
        repo: "privilege/SE1-Privilege-Agent-Setup-Mac.md",
        pdf: null,
        covers:
          "Agent-based persona onboarding for the shared Demo Engineering environment, run on your own Mac instead of Windows 11 VMs.",
      },
      {
        title: "Demo script & setup",
        drive: DRIVE_FOLDER,
        repo: "privilege/demo/privilege-demo-script.md",
        pdf: null,
        covers:
          "The customer-facing demo script and setup (auto-generated from the use-case docs — do not hand-edit).",
      },
      {
        title: "CIMD client documents",
        drive: drive("1jChSDZBpzhhcJbji5yDXvgg8ulfzyRxp"),
        repo: "docs/2026-10-07-cimd-privilege-client-documents.md",
        pdf: "drive",
        covers:
          "CIMD (client metadata documents) for PingOne Privilege — flow, boundary, and client documents, with diagrams.",
      },
      {
        title: "MCP discovery-gating demo",
        drive: DRIVE_FOLDER,
        repo: "privilege/MCP-DISCOVERY-DEMO.md",
        pdf: "drive",
        covers:
          "SE demo script: an agent's tools/list returns only what its policy grants — permit door, deny-by-default door, grant change, agent key, aggregate; pre-demo check and troubleshooting (every claim measured 2026-10-02…04).",
      },
      {
        title: "Ping's reference demo, explained",
        drive: drive("10hTWWOaHpl9CCip_GjxQgnYX9-sAFaAa"),
        repo: "privilege/PINGS-REFERENCE-DEMO-EXPLAINED.md",
        pdf: "drive",
        covers:
          "The two-agent demo (aigwdemo) from the source up: three processes, the six legs and which cross the gateway, the four ADK traps the demo solves (A2A bearer, card object, transportOptions, GatewayGemini), the seeded findings, the UI's eight detector groups, and the runbook condensed (source-verified 2026-10-09, not yet run).",
      },
      {
        title: "Policies in depth",
        drive: drive("1L5Bcgb4ZbbyG2LYAYtcuk7ZQQM6-OwV1"),
        repo: "privilege/PRIVILEGE-POLICIES-IN-DEPTH.md",
        pdf: "drive",
        covers:
          "What tool policies do when there is more than one: the union model (create adds, expiry silently subtracts, delete subtracts identically, edit-down does nothing), discovery-gating and why the client never sees \"denied\", the four indistinguishable 403s, groups (documented, not reproduced), per-app scope, and when a \"policy problem\" isn't one — every step measured live 2026-10-10.",
      },
      {
        title: "Agent mode end to end",
        drive: drive("10oribAOVkel4dH7wsE8XQWN0XZUCk9xL"),
        repo: "privilege/AGENT-MODE-END-TO-END.md",
        pdf: "drive",
        covers:
          "The Privilege Agent on a Mac, measured: device-bound identity in the Secure Enclave, pairing and re-pairing order, the local console, the cloud frontend's 403 gate — and the reframe: the agent is an identity anchor, not an MCP transport (cm-mcpgw is gone; MCP runs through the agentless gateways). Stale-agent-doc corrections included; paired live 2026-10-10.",
      },
    ],
  },
  {
    id: "reference",
    label: "Reference & records",
    docs: [
      {
        title: "OpenAPI MCP on Kubernetes",
        drive: DRIVE_FOLDER,
        repo: "privilege/OPENAPI-KUBERNETES-WORKING-PATTERN-2026-10-01.md",
        pdf: "repo",
        covers:
          "Working patterns for OpenAPI-based MCP on Kubernetes and the remaining gap (2026-10-01, updated 2026-10-03).",
      },
      {
        title: "Fix Privilege MCP guide — status",
        drive: DRIVE_FOLDER,
        repo: "docs/privilege-mcp-guide-status.md",
        pdf: null,
        covers:
          "Status split from the raw punch list of the ai-demo.ping-devops.com guide fix; original numbering kept for traceability.",
      },
      {
        title: "Status snapshot 2026-08-02",
        drive: DRIVE_FOLDER,
        repo: "privilege/PRIVILEGE-MCP-STATUS-2026-08-02.md",
        pdf: null,
        covers:
          "Point-in-time snapshot, superseded by the canonical record. Kept as historical evidence only.",
      },
      {
        title: "Ping decks & exports",
        drive: null,
        repo: null,
        pdf: "drive",
        covers:
          "Ping-provided decks and older exports: Privilege-AIGuard, Privilege-AI-Gateway, Privilege+Shared Demo, Instructional Demo Setup (Confluence export + SE1), Technical Summary v1/v2.",
      },
      {
        title: "SE enablement storyboards",
        drive: null,
        repo: null,
        pdf: null,
        covers:
          "Ping's SE storyboards (HTML, ~13 MB of embedded images, not committed): architecture, flows, troubleshooting order. The older deck's EvaluateHost routing model is disproven on build v1.260726.",
      },
    ],
  },
];

const PLANNED = [];

const ASSETS_NOTE = [
  "privilege/design/",
  "privilege/diagrams/",
  "privilege/postman/",
  "privilege/runbooks/",
  ".claude/skills/privilege-*",
];

const totalDocs = SECTIONS.reduce((sum, s) => sum + s.docs.length, 0);

export default function PrivilegeDocsIndexPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      docs: section.docs.filter((doc) =>
        [
          section.label,
          doc.title,
          doc.covers,
          doc.coversLink?.label || "",
          doc.repo || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      ),
    })).filter((section) => section.docs.length > 0);
  }, [query]);

  return (
    <div className="pdi-page">
      <header className="pdi-header">
        <div className="pdi-header-inner">
          <p className="pdi-eyebrow">Learning Hub · Ping AI Products</p>
          <h1>Privilege documentation index</h1>
          <p className="pdi-sub">
            Every Privilege doc we own, in one place — {totalDocs} documents
            across {SECTIONS.length} sections. All links point at{" "}
            <a
              href={DRIVE_FOLDER}
              target="_blank"
              rel="noopener noreferrer"
            >
              the shared Google Drive folder
            </a>{" "}
            ("PingOne Privilege - SE &amp; Architecture Docs") — no Ping GitHub
            access needed. Docs without a Drive copy yet link to the folder
            root; the repo path under each title is the maintainer reference
            (sources stay in AI-DEMO2).
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

        <div className="pdi-note">
          <p>
            <strong>PDF column legend:</strong>{" "}
            <span className="pdi-chip">In repo</span> — the PDF lives in the
            repo (Drive copy linked) ·{" "}
            <a
              href={DRIVE_FOLDER}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="pdi-chip pdi-chip--plain">Drive (SE)</span>
            </a>{" "}
            — the PDF ships through the shared Google Drive folder (no public
            link) · <span className="pdi-chip pdi-chip--dash">—</span> — no PDF
            export.
          </p>
        </div>

        <ul className="pdi-toc" aria-label="Jump to a section">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#pdi-${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ul>

        {filtered.length === 0 && (
          <p className="pdi-empty" role="status">
            No documents match “{query}”.
          </p>
        )}

        {filtered.map((section) => (
          <section
            key={section.id}
            id={`pdi-${section.id}`}
            className="pdi-section"
            aria-label={section.label}
          >
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
                        {doc.drive ? (
                          <a
                            href={doc.drive}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {doc.title}
                          </a>
                        ) : (
                          doc.title
                        )}
                        <code className="pdi-fname">{doc.repo || "—"}</code>
                      </th>
                      <td>
                        {doc.pdf === "repo" ? (
                          <a
                            className="pdi-chip"
                            href={doc.drive || DRIVE_FOLDER}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            In repo
                          </a>
                        ) : doc.pdf === "drive" ? (
                          <a
                            className="pdi-chip pdi-chip--plain"
                            href={DRIVE_FOLDER}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Drive (SE)
                          </a>
                        ) : (
                          <span className="pdi-none">—</span>
                        )}
                      </td>
                      <td>
                        {doc.covers}
                        {doc.coversLink && (
                          <>
                            {" "}
                            <a
                              href={doc.coversLink.href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {doc.coversLink.label}
                            </a>
                            .
                          </>
                        )}
                      </td>
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

        {PLANNED.length > 0 && (
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
        )}

        <p className="pdi-footer-meta">
          New docs: write the doc, update both indexes (
          <code>privilege/DOCUMENTATION-INDEX.md</code> and this page), then
          export. Counts on this page are computed from the data above.
        </p>
      </div>
    </div>
  );
}
