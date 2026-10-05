import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ShellTerminalView } from "../ShellTerminalView";
import { ShellVsCodeView } from "../ShellVsCodeView";
import { ShellDesktopView } from "../ShellDesktopView";
import { ShellRoutingTree } from "../ShellParts";
import { PrivilegeShellPanel } from "../PrivilegeShellPanel";

export const makeSession = (over = {}) => ({
  phase: "ready", scopes: [], tools: [], latestCall: null, busy: false, notice: "",
  messages: [], thinking: false,
  connect: vi.fn(), retryTools: vi.fn(), signOut: vi.fn(), runTool: vi.fn(), send: vi.fn(),
  pickPath: vi.fn(), pickDoor: vi.fn(),
  pvsTheme: "auto", cyclePvsTheme: vi.fn(),
  needsRearm: false, rearmReason: null, rearm: vi.fn(), probeDoors: vi.fn(),
  routing: { gatewaySession: null, preflight: null, preflightBusy: false, preflightError: "", gatewayMode: "privilege", config: { mcpUrl: "https://gw.example/privilege-gateway/banking/mcp" }, presets: [
    { mode: "privilege", url: "https://gw.example/privilege-gateway/banking/mcp" },
    { mode: "privilege", url: "https://gw.example/privilege-gateway/other/mcp" },
  ], llmPath: "", llmGatewayUrl: "", loaded: true },
  ...over,
});

describe("ShellTerminalView", () => {
  it("submits the typed prompt via session.send and clears the box", () => {
    const session = makeSession();
    render(<ShellTerminalView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "find transfer scope checks" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("find transfer scope checks");
    expect(box).toHaveValue("");
  });

  it("renders user line, step lines and the reply", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Found 2 tools", steps: ["mcp_initialized", "tools_discovered:2"], decision: null, execution: { ok: true } },
      ],
    });
    render(<ShellTerminalView session={session} />);
    const log = screen.getByRole("log", { name: "Terminal" });
    expect(log).toHaveTextContent("list safes");
    expect(log).toHaveTextContent("tools_discovered:2");
    expect(log).toHaveTextContent("Found 2 tools");
    expect(log).toHaveTextContent('"ok": true');
  });

  it("offers sign-in when signed out and hides the prompt", () => {
    const session = makeSession({ phase: "signed-out" });
    render(<ShellTerminalView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Get MCP tools" }));
    expect(session.connect).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  });

  it("disables the prompt while a reply is pending", () => {
    render(<ShellTerminalView session={makeSession({ thinking: true })} />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeDisabled();
  });
});

describe("ShellVsCodeView", () => {
  it("sends from the chat box", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "list safes" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("list safes");
  });

  it("puts the reply in chat and steps + execution in the tool-output drawer", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Found 2 tools", steps: ["tools_discovered:2"], decision: null, execution: { ok: true } },
      ],
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("Found 2 tools");
    const drawer = screen.getByRole("region", { name: "Tool output" });
    expect(drawer).toHaveTextContent("tools_discovered:2");
    expect(drawer).toHaveTextContent('"ok": true');
  });

  it("shows the latest tool run from the Tools table in the drawer", () => {
    const session = makeSession({
      latestCall: { name: "list_safes", request: "{}", response: '{"safes":[]}', ok: true },
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByRole("region", { name: "Tool output" })).toHaveTextContent("list_safes");
  });
});

describe("ShellDesktopView", () => {
  it("renders a tool-call card for a decision/execution and the reply bubble", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Here are the safes", steps: ["tools_discovered:2"], decision: { tool: "list_safes" }, execution: { ok: true } },
      ],
    });
    render(<ShellDesktopView session={session} />);
    const thread = screen.getByRole("log", { name: "Conversation" });
    expect(thread).toHaveTextContent("Here are the safes");
    const card = screen.getByRole("article", { name: "Tool call" });
    expect(card).toHaveTextContent("list_safes");
    expect(card).toHaveTextContent('"ok": true');
  });

  it("renders a plain reply with no card", () => {
    const session = makeSession({
      messages: [{ id: 1, role: "assistant", content: "Hi", steps: [], decision: null, execution: null }],
    });
    render(<ShellDesktopView session={session} />);
    expect(screen.queryByRole("article", { name: "Tool call" })).toBeNull();
  });

  it("sends from the message box", () => {
    const session = makeSession();
    render(<ShellDesktopView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("hello");
  });
});

describe("ShellGate footer", () => {
  it("offers Sign out when ready and calls session.signOut", () => {
    const session = makeSession();
    render(<ShellTerminalView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalled();
  });

  it("has no Sign out when signed out", () => {
    render(<ShellTerminalView session={makeSession({ phase: "signed-out" })} />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("scroll to newest", () => {
  it.each([
    ["terminal", ShellTerminalView, "Terminal"],
    ["vscode", ShellVsCodeView, "Chat"],
    ["desktop", ShellDesktopView, "Conversation"],
  ])("%s log scrolls to the bottom when a message arrives", (_n, View, label) => {
    const msg = (id) => ({ id, role: "user", content: `m${id}`, steps: [], decision: null, execution: null });
    const { rerender } = render(<View session={makeSession({ messages: [msg(1)] })} />);
    const log = screen.getByRole("log", { name: label });
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 500 });
    log.scrollTop = 0;
    rerender(<View session={makeSession({ messages: [msg(1), msg(2)] })} />);
    expect(log.scrollTop).toBe(500);
  });
});

describe("tools (VS Code)", () => {
  it("shows tools by default and runs one via runTool", async () => {
    const session = makeSession({
      tools: [{ name: "list_safes", description: "d", inputSchema: { properties: {} } }],
      runTool: vi.fn().mockResolvedValue("{}"),
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByText("list_safes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(session.runTool).toHaveBeenCalledWith("list_safes", expect.any(String)));
  });

  it("hides tools on an LLM path with a note", () => {
    const session = makeSession({
      tools: [{ name: "list_safes", inputSchema: { properties: {} } }],
      routing: { ...makeSession().routing, llmPath: "anthropic" },
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.queryByText("list_safes")).toBeNull();
    expect(screen.getByText("Tools apply to MCP paths.")).toBeInTheDocument();
  });

  it("offers Load tools when none are loaded", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Load tools" }));
    expect(session.retryTools).toHaveBeenCalled();
  });
});

describe.each([
  ["Terminal", ShellTerminalView],
  ["Claude Desktop", ShellDesktopView],
])("routing bar + tools (%s)", (_name, View) => {
  const tool = { name: "list_safes", description: "d", inputSchema: { properties: {} } };

  it("shows Path and Door pickers and calls pickPath / pickDoor", () => {
    const session = makeSession();
    render(<View session={session} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Connection path" }), { target: { value: "facade" } });
    expect(session.pickPath).toHaveBeenCalledWith("facade");
    fireEvent.change(screen.getByRole("combobox", { name: "MCP backend (door)" }), {
      target: { value: "https://gw.example/privilege-gateway/other/mcp" },
    });
    expect(session.pickDoor).toHaveBeenCalledWith("https://gw.example/privilege-gateway/other/mcp");
  });

  it("shows a tool and runs it via runTool", async () => {
    const session = makeSession({ tools: [tool], runTool: vi.fn().mockResolvedValue("{}") });
    render(<View session={session} />);
    expect(screen.getByText("list_safes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(session.runTool).toHaveBeenCalledWith("list_safes", expect.any(String)));
  });

  it("shows the latest tool run", () => {
    const latestCall = { name: "list_safes", request: "{}", response: '{"ok":true}', ok: true };
    render(<View session={makeSession({ latestCall })} />);
    const region = screen.getByRole("region", { name: "Latest tool run" });
    expect(region).toHaveTextContent("list_safes");
    expect(region).toHaveTextContent("Success");
  });

  it("still sends the prompt via session.send", () => {
    const session = makeSession();
    render(<View session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("hi");
  });

  it("hides tools on an LLM path with a note", () => {
    const session = makeSession({ tools: [tool], routing: { ...makeSession().routing, llmPath: "anthropic" } });
    render(<View session={session} />);
    expect(screen.queryByText("list_safes")).toBeNull();
    expect(screen.getByText("Tools apply to MCP paths.")).toBeInTheDocument();
  });
});

describe("ShellRoutingBar reachability and door fallback", () => {
  it("shows the routing bar when signed out and door change calls pickDoor", () => {
    const session = makeSession({ phase: "signed-out" });
    render(<ShellTerminalView session={session} />);
    expect(screen.getByRole("combobox", { name: "Connection path" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "MCP backend (door)" }), {
      target: { value: "https://gw.example/privilege-gateway/other/mcp" },
    });
    expect(session.pickDoor).toHaveBeenCalledWith("https://gw.example/privilege-gateway/other/mcp");
  });

  it("does not show the routing bar while loading, and renders it once when ready", () => {
    const { unmount } = render(<ShellTerminalView session={makeSession({ phase: "loading" })} />);
    expect(screen.queryByRole("combobox", { name: "Connection path" })).toBeNull();
    unmount();
    render(<ShellTerminalView session={makeSession()} />);
    expect(screen.getAllByRole("combobox", { name: "Connection path" })).toHaveLength(1);
  });

  it("reflects a backend that is not in the presets", () => {
    const base = makeSession();
    const session = makeSession({
      routing: { ...base.routing, config: { mcpUrl: "https://gw.example/privilege-gateway/console-only/mcp" } },
    });
    render(<ShellTerminalView session={session} />);
    const door = screen.getByRole("combobox", { name: "MCP backend (door)" });
    expect(door).toHaveDisplayValue("console-only");
    expect(within(door).getAllByRole("option")).toHaveLength(3);
  });

  it("disables both selects while a reply is pending", () => {
    render(<ShellTerminalView session={makeSession({ thinking: true })} />);
    expect(screen.getByRole("combobox", { name: "Connection path" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "MCP backend (door)" })).toBeDisabled();
  });
});

describe("ShellRoutingTree (VS Code side panel)", () => {
  const OTHER = "https://gw.example/privilege-gateway/other/mcp";

  it("lists the three MCP and three LLM paths, marks the active one and calls pickPath", () => {
    const session = makeSession();
    render(<ShellRoutingTree session={session} />);
    const group = screen.getByRole("group", { name: "Connection path" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["Direct", "Privilege", "Façade", "Anthropic", "Google", "OpenAI"]);
    expect(within(group).getByRole("button", { name: "Privilege" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Direct" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(group).getByRole("button", { name: "Façade" }));
    expect(session.pickPath).toHaveBeenCalledWith("facade");
    fireEvent.click(within(group).getByRole("button", { name: "Anthropic" }));
    expect(session.pickPath).toHaveBeenCalledWith("llm:anthropic");
  });

  it("marks an LLM path instead of the MCP mode when one is active", () => {
    const session = makeSession({ routing: { ...makeSession().routing, llmPath: "anthropic" } });
    render(<ShellRoutingTree session={session} />);
    expect(screen.getByRole("button", { name: "Anthropic" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Privilege" })).toHaveAttribute("aria-pressed", "false");
  });

  it("lists this mode's doors by name, marks the current one and calls pickDoor", () => {
    const session = makeSession();
    render(<ShellRoutingTree session={session} />);
    const group = screen.getByRole("group", { name: "MCP backend (door)" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["banking", "other"]);
    expect(within(group).getByRole("button", { name: "banking" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "other" }));
    expect(session.pickDoor).toHaveBeenCalledWith(OTHER);
  });

  it("shows a backend that is not in the presets as the selected door", () => {
    const base = makeSession();
    const session = makeSession({
      routing: { ...base.routing, config: { mcpUrl: "https://gw.example/privilege-gateway/console-only/mcp" } },
    });
    render(<ShellRoutingTree session={session} />);
    const group = screen.getByRole("group", { name: "MCP backend (door)" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["console-only", "banking", "other"]);
    expect(within(group).getByRole("button", { name: "console-only" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the current door as text when the mode has no presets", () => {
    const session = makeSession({ routing: { ...makeSession().routing, presets: [] } });
    render(<ShellRoutingTree session={session} />);
    expect(screen.queryByRole("group", { name: "MCP backend (door)" })).toBeNull();
    expect(screen.getByText("banking")).toBeInTheDocument();
  });

  it.each([
    ["busy", { busy: true }],
    ["thinking", { thinking: true }],
    ["not loaded", { routing: { ...makeSession().routing, loaded: false } }],
  ])("disables every item while %s", (_label, over) => {
    render(<ShellRoutingTree session={makeSession(over)} />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("VS Code view leaves routing to the side panel", () => {
  it.each(["ready", "signed-out"])("renders no route controls in the chat pane when %s", (phase) => {
    render(<ShellVsCodeView session={makeSession({ phase })} />);
    expect(screen.queryByRole("combobox", { name: "Connection path" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Connection path" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "MCP backend (door)" })).toBeNull();
  });
});

describe("force light/dark toggle (shared footer)", () => {
  it.each([
    ["auto", "Theme: Auto"],
    ["light", "Theme: Light"],
    ["dark", "Theme: Dark"],
  ])("labels the toggle for %s and calls cyclePvsTheme", (pvsTheme, label) => {
    const session = makeSession({ pvsTheme });
    render(<ShellTerminalView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(session.cyclePvsTheme).toHaveBeenCalledTimes(1);
  });

  it.each(["loading", "signed-out"])("is still offered when %s, without Sign out", (phase) => {
    render(<ShellTerminalView session={makeSession({ phase })} />);
    expect(screen.getByRole("button", { name: "Theme: Auto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe.each([
  ["Terminal", ShellTerminalView, "pvs-terminal"],
  ["VS Code", ShellVsCodeView, "pvs-vscode"],
  ["Claude Desktop", ShellDesktopView, "pvs-desktop"],
])("force light/dark on the %s root", (_name, View, testId) => {
  it("sets data-pvs-theme only when forced", () => {
    const { rerender } = render(<View session={makeSession({ pvsTheme: "dark" })} />);
    expect(screen.getByTestId(testId)).toHaveAttribute("data-pvs-theme", "dark");
    rerender(<View session={makeSession({ pvsTheme: "light" })} />);
    expect(screen.getByTestId(testId)).toHaveAttribute("data-pvs-theme", "light");
    rerender(<View session={makeSession({ pvsTheme: "auto" })} />);
    expect(screen.getByTestId(testId)).not.toHaveAttribute("data-pvs-theme");
  });
});

describe.each([
  ["VS Code", ShellVsCodeView],
  ["Terminal", ShellTerminalView],
  ["Desktop", ShellDesktopView],
  ["generic (chatgpt/saas)", (p) => <PrivilegeShellPanel skin="chatgpt" {...p} />],
])("%s skin activity strip", (name, View) => {
  it("shows recent API calls in plain words even when signed out, with a 401 explained", async () => {
    const { appendTrafficEntry } = await import("../../../services/apiTrafficStore");
    render(<View session={makeSession({ phase: "signed-out" })} />);
    act(() => {
      appendTrafficEntry({ method: "GET", url: `/api/tools?${name}`, status: 401, duration: 12 });
    });
    // The store is a module singleton, so match the row by this test's own URL.
    const row = (await screen.findByText(`/api/tools?${name}`)).closest("li");
    expect(within(row).getByText("Not signed in, or the session expired")).toBeInTheDocument();
  });
});

describe.each([
  ["Terminal", ShellTerminalView],
  ["VS Code", ShellVsCodeView],
  ["Desktop", ShellDesktopView],
])("%s Re-arm banner", (_name, View) => {
  it.each(["ready", "signed-out", "loading"])("shows and fires Re-arm in phase %s", (phase) => {
    const session = makeSession({ phase, needsRearm: true, rearmReason: "expired" });
    render(<View session={session} />);
    expect(screen.getByText(/Gateway session expired\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-arm" }));
    expect(session.rearm).toHaveBeenCalled();
  });

  it("words the not-established reason", () => {
    render(<View session={makeSession({ needsRearm: true, rearmReason: "not established" })} />);
    expect(screen.getByText(/Gateway session not established\./)).toBeInTheDocument();
  });

  it("shows nothing when no re-arm is needed", () => {
    render(<View session={makeSession()} />);
    expect(screen.queryByText(/Gateway session/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-arm" })).toBeNull();
  });

  it("disables the button and says Re-arming… while busy", () => {
    render(<View session={makeSession({ needsRearm: true, rearmReason: "expired", busy: true })} />);
    expect(screen.getByRole("button", { name: "Re-arming…" })).toBeDisabled();
  });
});

describe.each([
  ["Terminal", ShellTerminalView, {}],
  ["Desktop", ShellDesktopView, {}],
  ["signed-out gate", ShellTerminalView, { phase: "signed-out" }],
])("Check doors bar (%s)", (_n, View, over) => {
  const withRouting = (r, extra = {}) => {
    const base = makeSession();
    return makeSession({ ...over, ...extra, routing: { ...base.routing, ...r } });
  };

  it("calls probeDoors from the Check doors button", () => {
    const session = makeSession(over);
    render(<View session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Check doors" }));
    expect(session.probeDoors).toHaveBeenCalled();
  });

  it("reads Probing… and is disabled while probing", () => {
    render(<View session={withRouting({ preflightBusy: true })} />);
    expect(screen.getByRole("button", { name: "Probing…" })).toBeDisabled();
  });

  it.each([["busy", { busy: true }], ["thinking", { thinking: true }]])("is disabled while %s", (_k, extra) => {
    render(<View session={withRouting({}, extra)} />);
    expect(screen.getByRole("button", { name: "Check doors" })).toBeDisabled();
  });

  it("lists probe results with marks", () => {
    render(<View session={withRouting({ preflight: [
      { url: "https://gw.example/privilege-gateway/other/mcp", ok: true, tools: 3 },
      { url: "https://gw.example/privilege-gateway/x/mcp", ok: false, status: 401, error: "Unauthorized" },
    ] })} />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toContain("✅ other 3 tools");
    expect(rows).toContain("❌ x 401 Unauthorized");
  });

  it("says when there are no other doors", () => {
    render(<View session={withRouting({ preflight: [] })} />);
    expect(screen.getByText("No other doors to probe. The selected door is skipped; add a preset for another one.")).toBeInTheDocument();
  });

  it("shows a probe error as an alert", () => {
    render(<View session={withRouting({ preflightError: "Not authenticated." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not authenticated.");
  });

  it("shows nothing extra when there is no result and no error", () => {
    render(<View session={withRouting({})} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/No other doors/)).toBeNull();
  });
});

describe("ShellRoutingTree Check doors", () => {
  const OTHER = "https://gw.example/privilege-gateway/other/mcp";
  const withRouting = (r, extra = {}) => makeSession({ ...extra, routing: { ...makeSession().routing, ...r } });

  it("calls probeDoors and disables while busy, thinking or probing", () => {
    const session = makeSession();
    const { rerender } = render(<ShellRoutingTree session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Check doors" }));
    expect(session.probeDoors).toHaveBeenCalled();
    rerender(<ShellRoutingTree session={withRouting({}, { busy: true })} />);
    expect(screen.getByRole("button", { name: "Check doors" })).toBeDisabled();
    rerender(<ShellRoutingTree session={withRouting({}, { thinking: true })} />);
    expect(screen.getByRole("button", { name: "Check doors" })).toBeDisabled();
    rerender(<ShellRoutingTree session={withRouting({ preflightBusy: true })} />);
    expect(screen.getByRole("button", { name: "Probing…" })).toBeDisabled();
  });

  it("marks probed doors with a title and leaves others unmarked", () => {
    render(<ShellRoutingTree session={withRouting({ preflight: [{ url: OTHER, ok: false, status: 401, error: "Unauthorized" }] })} />);
    const group = screen.getByRole("group", { name: "MCP backend (door)" });
    const other = within(group).getByRole("button", { name: /other/ });
    expect(other).toHaveTextContent("❌ other");
    expect(other).toHaveAttribute("title", "401 Unauthorized");
    expect(within(group).getByRole("button", { name: "banking" })).not.toHaveAttribute("title");
  });

  it("shows the empty-result and error notes", () => {
    render(<ShellRoutingTree session={withRouting({ preflight: [], preflightError: "Not authenticated." })} />);
    expect(screen.getByText(/No other doors to probe/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Not authenticated.");
  });
});
