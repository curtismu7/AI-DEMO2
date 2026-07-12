// agentOnboardingFlows.js
// Static content transcribed from Tarun Madiraju's "Enterprise AI Onboarding &
// Governance Architecture" diagram — a proposed target-state architecture, not
// (yet) implemented in this repo. Drives AgentOnboardingFlowDiagram.jsx.
// Spec: docs/superpowers/specs/2026-07-12-agent-onboarding-flow-diagram-design.md

// Diagram lanes + cards. `key` values are referenced by each flow step's
// `activeCardKeys` to drive highlighting.
export const LANES = [
  {
    id: "actors",
    title: "Actors",
    cards: [
      {
        key: "actor-user",
        title: "Enterprise AI User",
        body: "Claude Desktop, Cursor, ChatGPT Enterprise, Copilot — an enterprise employee using an AI client.",
      },
      {
        key: "actor-dev",
        title: "Developer / Agent Builder",
        body: "Builds agents on Foundry, AWS, Vertex, or another platform.",
      },
      {
        key: "actor-admin",
        title: "Security / Identity Administrator",
        body: "Reviews and approves agents into enterprise governance.",
      },
      {
        key: "discovered-agent",
        title: "Unmanaged / Discovered AI Agent",
        body: "An agent already running — in a browser, on a device, or in a cloud platform — outside enterprise governance.",
      },
    ],
  },
  {
    id: "onboarding",
    title: "Onboarding",
    cards: [
      {
        key: "agent-studio",
        title: "Agent Studio",
        body: "Enterprise AI Onboarding Portal — orchestrates identity, MCP, and tool registration across the Ping platform.",
      },
    ],
  },
  {
    id: "governance",
    title: "Governance & Enforcement",
    cards: [
      {
        key: "iga-ai",
        title: "IGA for AI",
        body: "Inventory & cataloging, ownership & lifecycle, certification & review, governance & audit — single source of truth for all AI agents and MCPs.",
      },
      {
        key: "privileges-gw",
        title: "P1 Privileges MCP Gateway",
        body: "Policy enforcement for MCP access, step-up enforcement, session & activity logging, audits all actor activity.",
      },
      {
        key: "pinggateway",
        title: "PingGateway MCP Security Gateway",
        body: "Secures API access for MCP servers, performs token exchange/validation, routes authorization to PingAuthorize.",
      },
      {
        key: "pingauthorize",
        title: "PingAuthorize / PingOne Authorize",
        body: "Fine-grained, real-time policy decisions for agents, users, and resources.",
      },
    ],
  },
  {
    id: "runtime",
    title: "Enterprise Runtime",
    cards: [
      {
        key: "runtime",
        title: "Enterprise Runtime & Resources",
        body: "Applications, databases, APIs, files & storage, SaaS, enterprise systems — all traffic validated, authorized, and governed.",
      },
    ],
  },
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
        activeCardKeys: ["actor-user"],
      },
      {
        id: "eu-2",
        title: "Configure AI Capabilities",
        narrative: "Configure enterprise or personal AI workflows.",
        activeCardKeys: ["actor-user"],
      },
      {
        id: "eu-3",
        title: "Open Agent Studio",
        narrative: "Sign in using enterprise identity; discover configured MCPs or onboard MCPs into the privilege gateway.",
        activeCardKeys: ["actor-user", "agent-studio"],
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
        activeCardKeys: ["agent-studio", "privileges-gw"],
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
        activeCardKeys: ["actor-dev"],
      },
      {
        id: "dev-2",
        title: "Open Agent Studio",
        narrative: "Sign in using enterprise identity.",
        activeCardKeys: ["actor-dev", "agent-studio"],
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
        activeCardKeys: ["agent-studio", "privileges-gw"],
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
            activeCardKeys: ["discovered-agent", "actor-user"],
          },
          {
            id: "adm-bd-2",
            title: "Privilege MCP Gateway detects unmanaged AI activity",
            narrative: "The Privileges MCP Gateway observes MCP/API traffic and flags activity from an AI client it doesn't recognize.",
            activeCardKeys: ["privileges-gw", "discovered-agent"],
          },
          {
            id: "adm-bd-3",
            title: "Administrator is notified",
            narrative: "The Privileges MCP Gateway raises an alert to the Identity/Security Administrator.",
            activeCardKeys: ["actor-admin", "privileges-gw"],
          },
          {
            id: "adm-bd-4",
            title: "Administrator reviews the discovered AI assets",
            narrative: "The administrator reviews the discovered assets in the Privilege Admin console.",
            activeCardKeys: ["actor-admin"],
          },
          {
            id: "adm-bd-5",
            title: "Administrator approves onboarding into enterprise governance",
            narrative: "The administrator approves bringing the discovered agent into enterprise governance.",
            activeCardKeys: ["actor-admin", "agent-studio"],
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
            activeCardKeys: ["discovered-agent", "privileges-gw", "pinggateway", "pingauthorize", "runtime"],
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
            activeCardKeys: ["iga-ai", "discovered-agent"],
          },
          {
            id: "adm-cl-2",
            title: "Administrator reviews the discovered agents",
            narrative: "The administrator reviews the discovered agents.",
            activeCardKeys: ["actor-admin"],
          },
          {
            id: "adm-cl-3",
            title: "Administrator approves enterprise registration",
            narrative: "The administrator approves enterprise registration for the discovered agent.",
            activeCardKeys: ["actor-admin"],
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
            activeCardKeys: ["agent-studio", "privileges-gw"],
          },
          {
            id: "adm-cl-8",
            title: "Agent becomes governed and managed across the enterprise",
            narrative: "All runtime traffic is validated, authorized, and governed before accessing any resource.",
            activeCardKeys: ["discovered-agent", "privileges-gw", "pinggateway", "pingauthorize", "runtime"],
          },
        ],
      },
    },
  },
};

export const FLOW_ORDER = ["enterpriseUser", "developer", "admin"];
