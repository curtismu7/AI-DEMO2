// demo_api_ui/src/components/__tests__/AuditPage.test.jsx
// Guards the title-bar drag fix: mousedown on the action buttons (refresh /
// pop-out / close) must NOT start a window drag, otherwise a sub-pixel move
// swallows the button's click (PR #389).
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AuditPage from "../AuditPage";

const mockNavigate = vi.fn();
let searchParamsValue = "";

vi.mock("react-router-dom", () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(searchParamsValue)],
}));

// Render + flush the on-mount fetch so its state update settles inside act()
// (keeps the floating window mounted and the test output free of act warnings).
async function renderSettled(props) {
  const utils = render(<AuditPage {...props} />);
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsValue = "";
  // Floating window mode fetches the audit feed + summary on mount.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
  );
});

describe("AuditPage — agentId query-param seeding", () => {
  it("seeds the agent filter and includes it in the initial fetch", async () => {
    searchParamsValue = "agentId=demo-agent";

    await renderSettled({ onClose: vi.fn() });

    const calledWithAgentId = global.fetch.mock.calls.some(
      ([url]) => typeof url === "string" && url.includes("agentId=demo-agent"),
    );
    expect(calledWithAgentId).toBe(true);
  });
});

describe("AuditPage floating window — title-bar interaction", () => {
  it("does not drag the window when the mousedown lands on an action button", async () => {
    await renderSettled({ onClose: vi.fn() });
    const win = document.querySelector(".audit-float-window");
    const before = win.style.left;

    fireEvent.mouseDown(screen.getByLabelText("Close audit log"), {
      button: 0,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });

    expect(win.style.left).toBe(before); // no drag → position unchanged
  });

  it("drags the window when the mousedown lands on the bare title bar", async () => {
    await renderSettled({ onClose: vi.fn() });
    const win = document.querySelector(".audit-float-window");
    // Capture the origin rather than hardcoding it — the initial left depends
    // on DEFAULT_W vs the jsdom window width, not a fixed 0.
    const originLeft = parseFloat(win.style.left) || 0;

    fireEvent.mouseDown(document.querySelector(".audit-float-titlebar"), {
      button: 0,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });

    expect(parseFloat(win.style.left) - originLeft).toBe(220); // dx = 320 - 100
  });

  it("keeps the close button clickable after a mousedown + move on it (the #389 symptom)", async () => {
    const onClose = vi.fn();
    await renderSettled({ onClose });
    const win = document.querySelector(".audit-float-window");
    const before = win.style.left;
    const closeBtn = screen.getByLabelText("Close audit log");

    // Full interaction: press on the button, twitch the pointer, release, click.
    // The bug was that the twitch started a drag and swallowed the click.
    fireEvent.mouseDown(closeBtn, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    fireEvent.mouseUp(window, { clientX: 140, clientY: 60 });
    fireEvent.click(closeBtn);

    expect(win.style.left).toBe(before); // no drag was started
    expect(onClose).toHaveBeenCalledTimes(1); // click still delivered
  });
});

describe("AuditPage standalone pop-out", () => {
  it("uses the shared pop-out icon and closes from the upper-right control", async () => {
    searchParamsValue = "popout=1";
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    await renderSettled({ onClose: vi.fn() });

    expect(screen.getByLabelText("Close audit window")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close audit window"));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });
});

// ── Ping UI Standard conversion (/audit is enforced by scripts/check-ui-patterns.mjs) ─────────────────────────────
const EVENTS = [
  { eventId: "a1", timestamp: "2026-11-08T10:00:00Z", eventType: "tool_call", userId: "u1", operation: "get_balance", outcome: "success", duration: 12, details: { decision: "PERMIT", tokenScopes: ["banking:read"], acr: "Multi_factor", requiredGroup: "Customers", userGroups: ["Customers"] } },
  { eventId: "a2", timestamp: "2026-11-08T10:00:01Z", eventType: "tool_call", userId: "u2", operation: "transfer_funds", outcome: "failure", duration: 5, details: { alert: true, reason: "insufficient_scope", requiredScopes: ["banking:write"], availableScopes: [] } },
  { eventId: "a3", timestamp: "2026-11-08T10:00:02Z", eventType: "token_chain", outcome: "success", details: { toolName: "get_accounts", userToken: { sub: "user-sub-1", scope: ["banking:read"] }, exchangedToken: { sub: "agent-sub-1", act: { sub: "x" }, scope: ["banking:read"] }, result: { success: true, duration: 7 } } },
];
const SUMMARY = { totalEvents: 3, byOutcome: { success: 2, failure: 1 }, byEventType: { tool_call: 2, token_chain: 1 } };

function mockAudit({ events = EVENTS } = {}) {
  global.fetch = vi.fn((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes("summary=1") ? SUMMARY : events) }),
  );
}

describe("AuditPage — Ping UI Standard", () => {
  it("opens with the banner first, honest about what is real, and the window holds focus", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const banner = screen.getByTestId("audit-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.textContent).toMatch(/nothing simulated/i);
    // The banner is the first thing in the window's content, above the view switch and every section.
    const first = document.querySelector(".audit-pu").firstElementChild;
    expect(first).toContainElement(banner);
    expect(screen.getByRole("dialog", { name: "MCP Audit Trail" })).toHaveFocus();
  });

  it("gives focus back to the opener when the window closes", async () => {
    mockAudit();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = await renderSettled({ onClose: vi.fn() });
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it.each([["events", "Events"], ["compliance", "Compliance Report"]])(
    "%s view has exactly one primary button (Refresh) and no other",
    async (_name, tab) => {
      mockAudit();
      await renderSettled({ onClose: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: tab }));
      const primaries = document.querySelectorAll(".pu-btn--primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toHaveAccessibleName("Refresh audit log now");
    },
  );

  it("switches views with aria-pressed buttons, and explains the derived status only in the compliance view", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const events = screen.getByRole("button", { name: "Events" });
    const compliance = screen.getByRole("button", { name: "Compliance Report" });
    expect(events).toHaveAttribute("aria-pressed", "true");
    expect(compliance).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("audit-banner").textContent).not.toMatch(/derived from the call outcome/i);
    fireEvent.click(compliance);
    expect(compliance).toHaveAttribute("aria-pressed", "true");
    expect(events).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("audit-banner").textContent).toMatch(/derived from the call outcome/i);
  });

  it("Refresh keeps keyboard focus and ignores a second press while it loads (aria-disabled, not disabled)", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const refresh = screen.getByRole("button", { name: "Refresh audit log now" });
    refresh.focus();
    const calls = global.fetch.mock.calls.length;
    fireEvent.click(refresh);
    // loading: still focusable and focused, marked aria-disabled, label says so
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    expect(refresh).not.toBeDisabled();
    expect(refresh).toHaveFocus();
    expect(refresh).toHaveTextContent("Refreshing…");
    fireEvent.click(refresh); // ignored while loading
    await act(async () => {});
    expect(global.fetch.mock.calls.length).toBe(calls + 2); // one refresh = events + summary, not two
    expect(refresh).not.toHaveAttribute("aria-disabled");
    expect(refresh).toHaveFocus();
  });

  it("every chip carries a word; outcome tone follows what the gateway recorded", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const chips = [...document.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
    const word = (t) => chips.find((c) => c.textContent.trim() === t);
    expect(word("success")).toHaveClass("pu-chip--ok");
    expect(word("failure")).toHaveClass("pu-chip--danger");
    expect(word("Alert · unauthorized tool")).toHaveClass("pu-chip--danger");
  });

  it("token_chain rows expand from a real button with a name, exactly once per press, and a row click still works", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const btn = screen.getByRole("button", { name: "Show token details: get_accounts" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Hide token details: get_accounts" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("User Token")).toBeInTheDocument();
    fireEvent.click(document.querySelector("tr.token-chain-row")); // mouse users can still click the row
    expect(screen.queryByText("User Token")).not.toBeInTheDocument();
  });

  it("token_chain cells sit under their own column headers", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    const row = document.querySelector("tr.token-chain-row");
    const byLabel = (l) => row.querySelector(`td[data-label="${l}"]`);
    expect(byLabel("Event type")).toHaveTextContent("token_chain");
    expect(byLabel("User ID")).toHaveTextContent("user-sub-1");
    expect(byLabel("Agent ID")).toHaveTextContent("agent-sub-1 (delegated)");
    expect(byLabel("Tool / operation")).toHaveTextContent("get_accounts");
    expect(byLabel("Tool / operation")).toHaveTextContent("scopes: banking:read");
  });

  it("marks a compliance status inferred from the outcome, but not one the gateway decided", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Compliance Report" }));
    const rows = [...document.querySelectorAll(".audit-table tbody tr")];
    const decided = rows.find((r) => r.textContent.includes("get_balance"));
    const inferred = rows.find((r) => r.textContent.includes("transfer_funds"));
    expect(decided.textContent).not.toMatch(/from outcome/);
    expect(inferred.textContent).toMatch(/from outcome/);
    expect(inferred.querySelector('td[data-label="Status"] .pu-chip')).toHaveTextContent("DENY");
    expect(decided.querySelector('td[data-label="Group check"] .pu-chip')).toHaveTextContent("Pass: Customers");
  });

  it("exports the status source with the compliance CSV", async () => {
    mockAudit();
    await renderSettled({ onClose: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Compliance Report" }));
    let blob;
    const create = vi.fn((b) => { blob = b; return "blob:x"; });
    const orig = { c: URL.createObjectURL, r: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    anchorClick.mockRestore();
    URL.createObjectURL = orig.c;
    URL.revokeObjectURL = orig.r;
    const text = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); });
    const [head, ...lines] = text.split("\n");
    expect(head).toContain('"Status source"');
    expect(lines.find((l) => l.includes("get_balance"))).toContain('"decision"');
    expect(lines.find((l) => l.includes("transfer_funds"))).toContain('"outcome"');
  });

  it("shows a load failure as an alert with the word Error", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }));
    await renderSettled({ onClose: vi.fn() });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Error");
    expect(alert).toHaveTextContent("HTTP 403");
    expect(alert).toHaveTextContent("admin access required");
  });

  it("the pop-out page uses the same banner and primary, without a dialog", async () => {
    mockAudit();
    searchParamsValue = "popout=1";
    await renderSettled({ onClose: vi.fn() });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-banner")).toBeInTheDocument();
    expect(document.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
  });
});
