// demo_api_ui/src/components/aiFootprintMocks/mockSelection.js
// Persist costume-shell visual picks for SE gallery → live demo routes.

const STORAGE_KEY = "ai-footprint-mock-selection-v1";

/** @typedef {'vscode'|'chatgpt'|'saas'|'coding'|'claude-desktop'} MockCategory */

export const MOCK_CATALOG = {
  vscode: {
    label: "Platform-Native (VS Code + Copilot)",
    route: "/demo/vscode-copilot",
    variants: [
      { id: "classic-dark", name: "Classic dark", blurb: "Stock VS Code dark + Copilot Chat column" },
      { id: "light", name: "Light workbench", blurb: "Light editor chrome, blue accent status bar" },
      { id: "copilot-studio", name: "Studio panel", blurb: "Wider chat, thinner editor — Copilot Studio vibe" },
    ],
  },
  chatgpt: {
    label: "End-Point Native (ChatGPT desktop)",
    route: "/demo/chatgpt-desktop",
    variants: [
      { id: "desktop-dark", name: "Desktop dark", blurb: "macOS-style window + left history rail" },
      { id: "desktop-light", name: "Desktop light", blurb: "Light consumer app chrome" },
      { id: "web", name: "Web layout", blurb: "chatgpt.com–style centered column" },
    ],
  },
  saas: {
    label: "SaaS-Embedded",
    route: "/demo/saas-embedded",
    variants: [
      { id: "zendesk", name: "Support desk", blurb: "Zendesk-shaped ticket + agent sidebar" },
      { id: "glean", name: "Work search", blurb: "Glean-shaped enterprise search + assistant" },
      { id: "generic", name: "Vendor embed", blurb: "Generic SaaS top nav + right assistant drawer" },
    ],
  },
  coding: {
    label: "Coding — Claude Code / IDE agents",
    route: "/demo/coding-agent",
    variants: [
      { id: "claude-code", name: "Claude Code", blurb: "Terminal + agent panel (Claude Code–shaped)" },
      { id: "cursor", name: "AI IDE (Cursor-shaped)", blurb: "Editor + composer panel" },
      { id: "vscode-inline", name: "Inline assistant", blurb: "VS Code with inline ghost suggestion strip" },
    ],
  },
  "claude-desktop": {
    label: "Claude Desktop",
    route: "/demo/claude-desktop",
    variants: [
      { id: "desktop", name: "Claude Desktop", blurb: "Claude desktop workspace with connected MCP tools" },
    ],
  },
};

export const PRIVILEGE_CLIENT_SKINS = [
  { id: "", name: "Cursor", route: "/privilege-mcp-client" },
  { id: "vscode:classic-dark", name: "Visual Studio Code", route: "/demo/vscode-copilot?v=classic-dark" },
  { id: "coding:claude-code", name: "Claude Terminal", route: "/demo/coding-agent?v=claude-code" },
  { id: "claude-desktop:desktop", name: "Claude Desktop", route: "/demo/claude-desktop?v=desktop" },
];

const DEFAULTS = {
  vscode: "light",
  chatgpt: "desktop-light",
  saas: "generic",
  coding: "claude-code",
  "claude-desktop": "desktop",
};

/** Locked SE demo costumes (picker + live shells). */
export const LOCKED_PICKS = [
  {
    category: "coding",
    variant: "claude-code",
    short: "Claude Code",
    label: "Coding — Claude Code",
    route: "/demo/coding-agent",
  },
  {
    category: "vscode",
    variant: "light",
    short: "Light workbench",
    label: "Platform-Native — Light workbench",
    route: "/demo/vscode-copilot",
  },
  {
    category: "chatgpt",
    variant: "desktop-light",
    short: "Desktop light",
    label: "End-Point Native — Desktop light",
    route: "/demo/chatgpt-desktop",
  },
  {
    category: "saas",
    variant: "generic",
    short: "Vendor embed",
    label: "SaaS-Embedded — Vendor embed",
    route: "/demo/saas-embedded",
  },
];

/**
 * @returns {Record<MockCategory, string>}
 */
export function readMockSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @param {MockCategory} category
 * @param {string} variantId
 */
export function writeMockSelection(category, variantId) {
  const next = { ...readMockSelection(), [category]: variantId };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/**
 * @param {MockCategory} category
 */
export function selectedVariant(category) {
  const id = readMockSelection()[category];
  const list = MOCK_CATALOG[category]?.variants || [];
  return list.find((v) => v.id === id) || list[0];
}
