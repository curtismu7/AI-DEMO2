import { fireEvent, render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AgentIdentityAcademyPage from "../AgentIdentityAcademyPage";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

const { themeState } = vi.hoisted(() => ({
  themeState: { darkMode: false },
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => themeState,
}));

describe("AgentIdentityAcademyPage", () => {
  it("registers the Academy inside the application route shell", () => {
    const appSource = readFileSync(resolve("src/App.js"), "utf8");

    expect(appSource).toMatch(
      /<Route\s+path="\/academy\/identity"\s+element=\{\s*<AgentIdentityAcademyRoute\b[\s\S]*?\/>\s*\}\s*\/>/,
    );
  });

  it("embeds the standalone Academy without duplicating its prototype header", () => {
    render(<AgentIdentityAcademyPage />);

    expect(screen.getByTitle("Agent Identity Academy lessons")).toHaveAttribute(
      "src",
      "/academy-identity-preview.html?embedded=1",
    );
  });

  it("sends the last real run to the embedded Academy for Real mode", () => {
    render(<AgentIdentityAcademyPage />);
    const frame = screen.getByTitle("Agent Identity Academy lessons");
    const postMessage = vi.spyOn(frame.contentWindow, "postMessage");

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "academy-trace", steps: expect.any(Array) },
      window.location.origin,
    );
  });

  it("synchronizes the app theme into the embedded Academy", () => {
    themeState.darkMode = true;
    render(<AgentIdentityAcademyPage />);
    const frame = screen.getByTitle("Agent Identity Academy lessons");
    const postMessage = vi.spyOn(frame.contentWindow, "postMessage");

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "academy-theme", theme: "dark" },
      window.location.origin,
    );
  });

  // Task 2 deleted buildLiveTokenChainSteps from the rail; this page was its
  // one consumer outside the rail cluster, and a stale named import only
  // throws in the browser's ESM loader (vitest's transform tolerates it) —
  // which took the whole app down to a boot spinner on /agent-identity-academy.
  it("no longer imports the deleted buildLiveTokenChainSteps export", () => {
    const pageSource = readFileSync(resolve("src/pages/AgentIdentityAcademyPage.jsx"), "utf8");
    expect(pageSource).not.toContain("buildLiveTokenChainSteps");
  });

  it("projects the run through the shared visibility policy (fired hops only)", () => {
    act(() => tokenChainTraceStore.reset());
    render(<AgentIdentityAcademyPage />);
    const frame = screen.getByTitle("Agent Identity Academy lessons");
    const posted = [];
    vi.spyOn(frame.contentWindow, "postMessage").mockImplementation((msg) => posted.push(msg));

    fireEvent.load(frame);
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: "show my balance" });
      tokenChainTraceStore.ingestTokenEvent({ id: "gw-authorize", status: "done", decision: "PERMIT" });
      tokenChainTraceStore.completeTrace(true);
    });

    // The page posts on every store change; the last post carries the
    // completed run's projection — the same fired-hops list the rail draws.
    const traceMsg = posted.filter((m) => m?.type === "academy-trace").pop();
    expect(traceMsg).toBeTruthy();
    expect(traceMsg.steps.some((s) => s.id === "authorize" || s.baseId === "authorize")).toBe(true);
    act(() => tokenChainTraceStore.reset());
  });
});
