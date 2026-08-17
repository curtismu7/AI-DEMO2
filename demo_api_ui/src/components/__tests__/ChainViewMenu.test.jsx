import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChainViewMenu from "../ChainViewMenu";

const STEPS = [{ id: "signin", title: "Sign-in", lane: "PINGONE", status: "done", detail: {} }];

describe("ChainViewMenu", () => {
  it("keeps the seven views behind one control", async () => {
    render(<ChainViewMenu steps={STEPS} onOpenView={() => {}} />);
    expect(screen.queryByText("Tokens")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    for (const name of ["Tokens", "MCP", "Trust", "Simple", "Detailed", "Demo Track", "Topology"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("reports which view was chosen and closes", async () => {
    const onOpenView = vi.fn();
    render(<ChainViewMenu steps={STEPS} onOpenView={onOpenView} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(onOpenView).toHaveBeenCalledWith("mcp");
    expect(screen.queryByRole("button", { name: "Tokens" })).toBeNull();
  });

  it("reports Topology like any other view — the caller decides what that means", async () => {
    const onOpenView = vi.fn();
    render(<ChainViewMenu steps={STEPS} onOpenView={onOpenView} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    await userEvent.click(screen.getByRole("button", { name: "Topology" }));
    expect(onOpenView).toHaveBeenCalledWith("topology");
  });

  it("says where Token Chain lives, since it is not in the menu", async () => {
    render(<ChainViewMenu steps={STEPS} onOpenView={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByText(/Token Chain runs inline/i)).toBeInTheDocument();
  });

  it("drops Trust when the run has no DPoP/RAR evidence", async () => {
    render(<ChainViewMenu steps={STEPS} onOpenView={() => {}} showTrust={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.queryByRole("button", { name: "Trust" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tokens" })).toBeInTheDocument();
  });

  it("closes on Escape without choosing a view", async () => {
    const onOpenView = vi.fn();
    render(<ChainViewMenu steps={STEPS} onOpenView={onOpenView} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Tokens" })).toBeNull();
    expect(onOpenView).not.toHaveBeenCalled();
  });
});
