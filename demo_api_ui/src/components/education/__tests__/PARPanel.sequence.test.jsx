import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PARPanel from "../PARPanel";

vi.mock("../../shared/EducationDrawer", () => ({
  default: ({ tabs }) => (
    <div>
      {tabs.map((t) => (
        <section key={t.id} data-testid={`tab-${t.id}`}>{t.content}</section>
      ))}
    </div>
  ),
}));

describe("PARPanel — the PAR sequence, drawn", () => {
  it("renders the Full-flow tab with the sequence canvas and the step list", () => {
    render(<PARPanel isOpen initialTabId="flow" onClose={() => {}} />);
    // FlowDiagram's sequence renderer canvas (the reel testId confirms the
    // shared walkthrough attached).
    expect(screen.getByTestId("sequence-flow-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("sequence-reel")).toBeInTheDocument();
    // The numbered walkthrough remains beneath the diagram.
    expect(screen.getByText(/Client generates/i)).toBeInTheDocument();
  });
});
