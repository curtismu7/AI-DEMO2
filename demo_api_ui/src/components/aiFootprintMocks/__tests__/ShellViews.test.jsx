import { fireEvent, render, screen } from "@testing-library/react";
import { ShellTerminalView } from "../ShellTerminalView";

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
