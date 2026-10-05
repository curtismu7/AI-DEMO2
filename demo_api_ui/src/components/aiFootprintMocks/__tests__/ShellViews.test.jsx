import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ShellTerminalView } from "../ShellTerminalView";
import { ShellVsCodeView } from "../ShellVsCodeView";
import { ShellDesktopView } from "../ShellDesktopView";

export const makeSession = (over = {}) => ({
  phase: "ready", scopes: [], tools: [], latestCall: null, busy: false, notice: "",
  messages: [], thinking: false,
  connect: vi.fn(), retryTools: vi.fn(), signOut: vi.fn(), runTool: vi.fn(), send: vi.fn(),
  pickPath: vi.fn(), pickDoor: vi.fn(),
  routing: { gatewayMode: "privilege", config: { mcpUrl: "https://gw.example/privilege-gateway/banking/mcp" }, presets: [
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
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Privilege" }));
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

describe("routing bar + tools (VS Code)", () => {
  it("lists the three MCP paths and three LLM paths and calls pickPath", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const path = screen.getByRole("combobox", { name: "Connection path" });
    expect(within(path).getAllByRole("option").map((o) => o.textContent)).toEqual(
      ["Direct", "Privilege", "Façade", "Anthropic", "Google", "OpenAI"]);
    fireEvent.change(path, { target: { value: "facade" } });
    expect(session.pickPath).toHaveBeenCalledWith("facade");
  });

  it("lists this mode's doors by name and calls pickDoor", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const door = screen.getByRole("combobox", { name: "MCP backend (door)" });
    expect(within(door).getAllByRole("option").map((o) => o.textContent)).toEqual(["banking", "other"]);
    fireEvent.change(door, { target: { value: "https://gw.example/privilege-gateway/other/mcp" } });
    expect(session.pickDoor).toHaveBeenCalledWith("https://gw.example/privilege-gateway/other/mcp");
  });

  it("disables both selects while a switch is in flight", () => {
    render(<ShellVsCodeView session={makeSession({ busy: true })} />);
    expect(screen.getByRole("combobox", { name: "Connection path" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "MCP backend (door)" })).toBeDisabled();
  });

  it("shows the current door as text when the mode has no presets", () => {
    const session = makeSession({ routing: { ...makeSession().routing, presets: [] } });
    render(<ShellVsCodeView session={session} />);
    expect(screen.queryByRole("combobox", { name: "MCP backend (door)" })).toBeNull();
    expect(screen.getByText("banking")).toBeInTheDocument();
  });

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
