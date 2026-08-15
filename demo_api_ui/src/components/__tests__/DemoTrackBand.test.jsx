import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DemoTrackBand from "../DemoTrackBand";

const TRACK = [
  { n: 1, act: 1, title: "Delegated access", capability: "RFC 8693", buyerStory: "Every agent action traces to a human." },
  { n: 2, act: 1, title: "A2A delegation", capability: "Nested act", buyerStory: "Proof carries through the chain." },
  { n: 8, act: 2, title: "PingOne MCP admin", capability: "Hosted MCP", buyerStory: "The AI managing identity is governed by it." },
];

describe("DemoTrackBand", () => {
  it("shows the steps in order, grouped by act", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={0} onSelect={() => {}} />);
    expect(screen.getByText("Act 1")).toBeInTheDocument();
    expect(screen.getByText("Act 2")).toBeInTheDocument();
    expect(document.querySelectorAll(".dtb-chip")).toHaveLength(3);
  });

  it("gives the presenter the current step's line to say", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={1} onSelect={() => {}} />);
    expect(screen.getByText(/Proof carries through the chain\./)).toBeInTheDocument();
    expect(screen.getByText("Nested act")).toBeInTheDocument();
  });

  it("marks completed steps distinctly from the current one", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={2} onSelect={() => {}} />);
    expect(document.querySelectorAll(".dtb-chip--done")).toHaveLength(2);
    expect(document.querySelectorAll(".dtb-chip--on")).toHaveLength(1);
  });

  it("selects a step when clicked", async () => {
    const onSelect = vi.fn();
    render(<DemoTrackBand track={TRACK} activeIndex={0} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("A2A delegation"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("steps forward and back without running off either end", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<DemoTrackBand track={TRACK} activeIndex={0} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(onSelect).toHaveBeenCalledWith(1);

    rerender(<DemoTrackBand track={TRACK} activeIndex={2} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders nothing when there is no track", () => {
    const { container } = render(<DemoTrackBand track={[]} activeIndex={0} onSelect={() => {}} />);
    expect(container.querySelector(".dtb")).toBeNull();
  });
});
