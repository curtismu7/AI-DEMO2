import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import A2ADelegationPanel from "../A2ADelegationPanel";
import { A2A_RECORDED_RUN } from "../../../data/a2aRecordedRun";

vi.mock("../../../services/a2aSpecialistRegistry", () => ({
  fetchA2aSpecialistRegistry: vi.fn().mockResolvedValue([]),
  specialistRoleLabel: vi.fn((s) => s?.specialistName || "Specialist"),
}));

vi.mock("../../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));

vi.mock("../../shared/EducationDrawer", () => ({
  default: ({ tabs }) => (
    <div>
      {tabs.map((t) => (
        <section key={t.id} data-testid={`tab-${t.id}`}>{t.content}</section>
      ))}
    </div>
  ),
}));

describe("A2ADelegationPanel — the recorded delegation, drawn", () => {
  it("renders the recorded run's packet flow in the In-this-demo tab", () => {
    render(<A2ADelegationPanel isOpen initialTabId="demo" onClose={() => {}} />);
    // The real A2AFlowVisualizer mounts with the recorded chain.
    expect(document.querySelector(".a2fv")).not.toBeNull();
    // The explanatory line above it names the captured run's vertical.
    expect(screen.getByText(new RegExp(A2A_RECORDED_RUN.vertical))).toBeInTheDocument();
    // The teaching steps survive beneath.
    expect(screen.getByText(/How it shows up/i)).toBeInTheDocument();
  });
});
