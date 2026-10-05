import { fireEvent, render, screen } from "@testing-library/react";
import { ShellTerminalView } from "../ShellTerminalView";
import { ShellVsCodeView } from "../ShellVsCodeView";
import { ShellDesktopView } from "../ShellDesktopView";

export const makeSession = (over = {}) => ({
  phase: "ready", scopes: [], tools: [], latestCall: null, busy: false, notice: "",
  messages: [], thinking: false,
  connect: vi.fn(), retryTools: vi.fn(), signOut: vi.fn(), runTool: vi.fn(), send: vi.fn(),
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
