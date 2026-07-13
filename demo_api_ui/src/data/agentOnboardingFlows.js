// agentOnboardingFlows.js
// Static content transcribed from Tarun Madiraju's "Enterprise AI Onboarding &
// Governance Architecture" diagram — a proposed target-state architecture, not
// (yet) implemented in this repo. Drives AgentOnboardingFlowDiagram.jsx.
// ROWS mirrors the diagram's actual box layout (entry row, Agent Studio,
// orchestration bar, governance row, discovery+IGA row, runtime row) so the
// rendered diagram matches the source image box-for-box, not an abstraction.
// Spec: docs/superpowers/specs/2026-07-13-agent-onboarding-diagram-v2-design.md

// Six rows, top to bottom, matching the reference diagram. `key` values on
// boxes are referenced by each flow step's `activeCardKeys` to drive
// highlighting during the walkthrough.
export const ROWS = [
  {
    id: "entry",
    kind: "triple",
    boxes: [
      {
        key: "entry-user",
        legendNum: 1,
        title: "1. Enterprise Users (AI Consumers)",
        subtitle: "Use AI clients and add MCPs",
        tags: ["Claude Desktop", "Cursor", "VS Code (Copilot)", "ChatGPT Enterprise"],
        bullets: [
          "User adds/configures MCP servers in their AI client",
          "Open Agent Studio to register MCPs",
        ],
      },
      {
        key: "entry-dev",
        legendNum: 2,
        title: "2. Developers / Agent Builders",
        subtitle: "Build agents and publish MCPs",
        tags: ["Foundry", "AWS", "Vertex", "Other Platforms"],
        bullets: [
          "Build AI Agent on any platform",
          "Open Agent Studio",
          "Register Agent",
          "Register MCPs, Tools & Resources",
          "Publish MCP to PingGateway MCP Security Gateway (automatic orchestration)",
        ],
      },
      {
        key: "entry-admin",
        legendNum: 3,
        title: "3. Cloud Discovery (Admin)",
        subtitle: "Discover unmanaged agents in cloud",
        tags: ["Foundry", "AWS", "Vertex", "Other Platforms"],
        bullets: [
          "Agents discovered in cloud platforms",
          "Admin notified",
          "Admin reviews and imports to Agent Studio",
        ],
      },
    ],
    note: "Discovered agents in cloud that were not created through Agent Studio are brought in by administrators.",
  },
  {
    id: "agent-studio",
    kind: "single",
    box: {
      key: "agent-studio",
      title: "Agent Studio",
      subtitle: "Enterprise AI Onboarding Portal",
      columns: [
        {
          heading: "For Enterprise Users",
          items: ["Discover configured MCPs from AI clients", "Select and register MCPs"],
        },
        {
          heading: "For Developers",
          items: [
            "Register Agents",
            "Register MCPs, Tools, Resources",
            "Manage Agent metadata",
            "Publish FGA rules to PingAuthorize (as applies)",
            "Orchestrates onboarding across Ping platform (see below)",
          ],
        },
        {
          heading: "For Admins",
          items: ["Import discovered Agents", "Register MCPs, Tools, Resources", "Review & submit"],
        },
      ],
    },
    note: "Agent Studio is the single onboarding portal for all AI capabilities.",
  },
  {
    id: "orchestration",
    kind: "orchestration",
    label: "Agent Studio orchestrates onboarding across the Ping platform",
    box: {
      key: "orchestration",
      legendNum: 6,
      items: [
        "Create identity & metadata",
        "Publish MCP to PingGateway MCP Security Gateway",
        "Publish FGA rules to PingAuthorize (as applies)",
        "Register in IGA for AI for governance",
        "Keep metadata synchronized across platforms",
      ],
    },
    note: "Agent Studio eliminates siloed admin experiences and automates configuration across products.",
  },
  {
    id: "governance",
    kind: "triple",
    boxes: [
      {
        key: "privileges-gw",
        legendNum: 7,
        title: "P1 Privileges MCP Gateway",
        bullets: [
          "Policy enforcement for MCP access",
          "JIT access & secret injection",
          "Session & activity logging",
          "Audit all actor activity",
        ],
      },
      {
        key: "pinggateway",
        legendNum: 7,
        title: "PingGateway MCP Security Gateway",
        bullets: [
          "Secures all MCP communication",
          "Validates OAuth tokens",
          "Performs token exchange / transformation",
          "Validates MCP requests",
          "Routes authorization to PingAuthorize",
          "Audits all actor activity",
        ],
      },
      {
        key: "pingauthorize",
        legendNum: 7,
        title: "PingAuthorize / PingOne Authorize",
        bullets: [
          "Fine-grained authorization decisions for Agents, Users & Applications",
          "Policies for MCP tools, resources, APIs & actions",
          "Context-aware access control (real-time)",
        ],
      },
    ],
    note: "No duplicate routing: Privilege MCPs go directly to Privilege. Cloud/Platform MCPs go through PingGateway and PingAuthorize.",
  },
  {
    id: "discovery-iga",
    kind: "split",
    left: [
      {
        key: "privilege-discovery",
        legendNum: 4,
        title: "A. Privilege Discovery (Browser / Device Agents)",
        subtitle: "e.g., Claude Desktop, Cursor, VS Code, Browser AI, Device AI",
        bullets: [
          "Privilege MCP Gateway detects unmanaged AI activity",
          "Admin notified",
          "Admin reviews & approves onboarding",
          "Metadata synchronized to IGA",
        ],
        note: "Privilege is the gateway for these MCPs — traffic goes directly to the Privilege MCP Gateway.",
      },
      {
        key: "cloud-discovery-iga",
        legendNum: 5,
        title: "B. Cloud Discovery (IGA)",
        subtitle: "e.g., Foundry, AWS, Vertex",
        bullets: [
          "IGA discovers cloud-native AI agents",
          "Admin reviews & approves registration",
          "IGA requests Agent Identity creation in Ping Identity",
          "Metadata & identity synchronized back to IGA",
          "MCP resources associated with Agent Identity",
        ],
      },
    ],
    right: {
      key: "iga-ai",
      title: "IGA for AI",
      subtitle: "Intelligent Governance & Administration",
      columns: [
        "Inventory & Catalog",
        "Ownership & Lifecycle",
        "Entitlement Management",
        "Certification & Review",
        "Compliance & Audit",
      ],
      bullets: [
        "Single source of truth for all AI Agents, MCPs, Tools, Resources & Prompts",
        "Correlates identities across platforms and keeps all registrations in sync",
      ],
    },
    note: "IGA is the authoritative inventory and governance layer for all enterprise AI capabilities.",
  },
  {
    id: "runtime",
    kind: "single",
    box: {
      key: "runtime",
      title: "Enterprise AI Runtime",
      subtitle: "Secure access to MCP servers, tools, resources & enterprise systems with Agent Identity",
      tags: ["Applications", "Databases", "APIs", "Files & Storage", "SaaS", "Enterprise Systems"],
    },
    note: "All runtime traffic is validated, authorized, and governed before accessing any resource.",
  },
];

export const LEGEND = [
  { num: 1, label: "Entry / Discovery (Users)" },
  { num: 2, label: "Entry / Discovery (Developers)" },
  { num: 3, label: "Entry / Discovery (Admin)" },
  { num: 4, label: "Privilege Discovery (Browser/Device)" },
  { num: 5, label: "Cloud Discovery (IGA)" },
  { num: 6, label: "Orchestration / Governance" },
  { num: 7, label: "Runtime" },
];

// Three top-level flows. `admin` has two source stories (browser/device vs.
// cloud discovery) selectable within the tab.
export const FLOWS = {
  enterpriseUser: {
    label: "Enterprise AI User",
    persona: "Enterprise Employee / AI Consumer / Knowledge Worker",
    outcome:
      "Personal AI clients become enterprise-managed without changing the user's experience.",
    steps: [
      {
        id: "eu-1",
        title: "Open an AI Client",
        narrative: "Launch Claude Desktop, Cursor, ChatGPT Enterprise, Copilot, etc.",
        activeCardKeys: ["entry-user"],
      },
      {
        id: "eu-2",
        title: "Configure AI Capabilities",
        narrative: "Configure enterprise or personal AI workflows.",
        activeCardKeys: ["entry-user"],
      },
      {
        id: "eu-3",
        title: "Open Agent Studio",
        narrative: "Sign in using enterprise identity; discover configured MCPs or onboard MCPs into the privilege gateway.",
        activeCardKeys: ["entry-user", "agent-studio"],
      },
      {
        id: "eu-4",
        title: "Register MCPs",
        narrative: "Select the MCPs for access; register them with the privilege gateway.",
        activeCardKeys: ["agent-studio"],
      },
      {
        id: "eu-5",
        title: "Enterprise Registration",
        narrative: "MCPs are registered in the PingOne Privilege identity platform; metadata is created across PF, P1, AIC, AIS.",
        activeCardKeys: ["agent-studio", "orchestration", "privileges-gw"],
      },
      {
        id: "eu-6",
        title: "Governance",
        narrative: "IGA for AI discovers the registered MCPs from the privilege gateway; identity, lifecycle, and entitlements are established.",
        activeCardKeys: ["iga-ai", "privileges-gw"],
      },
      {
        id: "eu-7",
        title: "Secure Runtime",
        narrative: "MCP requests flow through the Privileges MCP Gateway; enterprise policies control access to tools, APIs, and resources.",
        activeCardKeys: ["privileges-gw", "pinggateway", "pingauthorize", "runtime"],
      },
    ],
  },

  developer: {
    label: "Developer / Agent Builder",
    persona: "Developer / AI Engineer / Agent Builder",
    outcome: "Every enterprise-built agent is governed, discoverable, and secured from day one.",
    steps: [
      {
        id: "dev-1",
        title: "Build an AI Agent",
        narrative: "Create an agent using Foundry, AWS, Vertex, or another platform.",
        activeCardKeys: ["entry-dev"],
      },
      {
        id: "dev-2",
        title: "Open Agent Studio",
        narrative: "Sign in using enterprise identity.",
        activeCardKeys: ["entry-dev", "agent-studio"],
      },
      {
        id: "dev-3",
        title: "Register the Agent",
        narrative: "Create the enterprise identity for the agent (PF, AIC, P1); register agent metadata.",
        activeCardKeys: ["agent-studio"],
      },
      {
        id: "dev-4",
        title: "Register Assets",
        narrative: "Register MCP servers, MCP resources, and MCP tools.",
        activeCardKeys: ["agent-studio"],
      },
      {
        id: "dev-5",
        title: "Publish to Enterprise",
        narrative: "Register with the Ping Identity Platform; publish MCPs to the Privileges Gateway.",
        activeCardKeys: ["agent-studio", "orchestration", "privileges-gw"],
      },
      {
        id: "dev-6",
        title: "Governance",
        narrative: "IGA for AI discovers the agent; establishes ownership; applies lifecycle management; assigns entitlements.",
        activeCardKeys: ["iga-ai"],
      },
      {
        id: "dev-7",
        title: "Runtime",
        narrative: "The agent securely accesses enterprise resources through the Privileges MCP Gateway.",
        activeCardKeys: ["privileges-gw", "pinggateway", "pingauthorize", "runtime"],
      },
    ],
  },

  admin: {
    label: "Security / Identity Administrator",
    persona: "Identity Administrator / Security Administrator / Governance Administrator",
    stories: {
      browserDevice: {
        label: "Story A — Browser & Device Discovery",
        outcome: "The browser/device AI agent becomes a managed enterprise AI asset.",
        steps: [
          {
            id: "adm-bd-1",
            title: "Browser and device AI agents are discovered",
            narrative: "Claude Desktop, Cursor, Browser AI, and Device AI clients are running unmanaged, outside enterprise governance.",
            activeCardKeys: ["privilege-discovery"],
          },
          {
            id: "adm-bd-2",
            title: "Privilege MCP Gateway detects unmanaged AI activity",
            narrative: "The Privileges MCP Gateway observes MCP/API traffic and flags activity from an AI client it doesn't recognize.",
            activeCardKeys: ["privileges-gw", "privilege-discovery"],
          },
          {
            id: "adm-bd-3",
            title: "Administrator is notified",
            narrative: "The Privileges MCP Gateway raises an alert to the Identity/Security Administrator.",
            activeCardKeys: ["entry-admin", "privileges-gw"],
          },
          {
            id: "adm-bd-4",
            title: "Administrator reviews the discovered AI assets",
            narrative: "The administrator reviews the discovered assets in the Privilege Admin console.",
            activeCardKeys: ["entry-admin"],
          },
          {
            id: "adm-bd-5",
            title: "Administrator approves onboarding into enterprise governance",
            narrative: "The administrator approves bringing the discovered agent into enterprise governance.",
            activeCardKeys: ["entry-admin", "agent-studio"],
          },
          {
            id: "adm-bd-6",
            title: "Agent metadata is synchronized to IGA",
            narrative: "Agent metadata is synchronized to IGA for AI.",
            activeCardKeys: ["iga-ai"],
          },
          {
            id: "adm-bd-7",
            title: "IGA establishes ownership, lifecycle, and entitlements",
            narrative: "IGA for AI establishes ownership, lifecycle, inventory, governance, and entitlements for the agent.",
            activeCardKeys: ["iga-ai"],
          },
          {
            id: "adm-bd-8",
            title: "Browser/Device AI becomes a managed enterprise AI asset",
            narrative: "The agent is now subject to the same runtime enforcement as any other enterprise agent.",
            activeCardKeys: ["privilege-discovery", "privileges-gw", "pinggateway", "pingauthorize", "runtime"],
          },
        ],
      },
      cloud: {
        label: "Story B — Cloud AI Discovery",
        outcome: "The agent becomes governed and managed across the enterprise.",
        steps: [
          {
            id: "adm-cl-1",
            title: "IGA discovers cloud-native AI agents",
            narrative: "IGA for AI discovers agents already running in Foundry, AWS, Vertex, or other cloud platforms.",
            activeCardKeys: ["iga-ai", "cloud-discovery-iga"],
          },
          {
            id: "adm-cl-2",
            title: "Administrator reviews the discovered agents",
            narrative: "The administrator reviews the discovered agents.",
            activeCardKeys: ["entry-admin", "cloud-discovery-iga"],
          },
          {
            id: "adm-cl-3",
            title: "Administrator approves enterprise registration",
            narrative: "The administrator approves enterprise registration for the discovered agent.",
            activeCardKeys: ["entry-admin"],
          },
          {
            id: "adm-cl-4",
            title: "IGA / Agent Studio requests Agent Identity creation",
            narrative: "IGA and Agent Studio request creation of an Agent Identity in PingOne / PingFederate / AIC.",
            activeCardKeys: ["iga-ai", "agent-studio"],
          },
          {
            id: "adm-cl-5",
            title: "Agent Studio creates the enterprise Agent Identity",
            narrative: "Agent Studio creates the enterprise Agent Identity.",
            activeCardKeys: ["agent-studio"],
          },
          {
            id: "adm-cl-6",
            title: "Agent metadata and identity are synchronized back to IGA",
            narrative: "Agent metadata and identity are synchronized back to IGA for AI.",
            activeCardKeys: ["iga-ai"],
          },
          {
            id: "adm-cl-7",
            title: "MCP resources are associated with the Agent Identity",
            narrative: "MCP resources are associated with the Agent Identity.",
            activeCardKeys: ["agent-studio", "orchestration", "privileges-gw"],
          },
          {
            id: "adm-cl-8",
            title: "Agent becomes governed and managed across the enterprise",
            narrative: "All runtime traffic is validated, authorized, and governed before accessing any resource.",
            activeCardKeys: ["cloud-discovery-iga", "privileges-gw", "pinggateway", "pingauthorize", "runtime"],
          },
        ],
      },
    },
  },
};

export const FLOW_ORDER = ["enterpriseUser", "developer", "admin"];
