import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MayActPanel from "../MayActPanel";

vi.mock("../../shared/EducationDrawer", () => ({
  default: ({ tabs }) => (
    <div>
      {tabs.map((t) => (
        <section key={t.id} data-testid={`tab-${t.id}`}>{t.content}</section>
      ))}
    </div>
  ),
}));

describe("MayActPanel — the act chain, drawn", () => {
  it("opens the Step-by-step tab with the audience chain rendered above the prose", () => {
    render(<MayActPanel isOpen initialTabId="lifecycle" onClose={() => {}} />);
    // TokenAudienceChain's own captions — the hop chain the lifecycle steps describe.
    expect(screen.getByText("User Token")).toBeInTheDocument();
    expect(screen.getByText("GW Token")).toBeInTheDocument();
    expect(screen.getByText("Backend Token")).toBeInTheDocument();
    expect(screen.getByText(/aud narrows each hop/i)).toBeInTheDocument();
    // The prose steps are still there beneath it.
    expect(screen.getByText(/You sign in/i)).toBeInTheDocument();
  });
});
