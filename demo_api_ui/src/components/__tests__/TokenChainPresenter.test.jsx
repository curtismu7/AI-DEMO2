import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenChainPresenter from "../TokenChainPresenter";

const STEPS = [
  {
    id: "signin",
    title: "Sign-in — User Token acquired",
    lane: "PINGONE",
    status: "done",
    detail: { narrative: "The user signs in.", kv: [["scope", "read write"]], rfcs: ["RFC 6749"] },
  },
  {
    id: "exchange",
    title: "Token exchange — delegation",
    lane: "BFF",
    status: "done",
    detail: { narrative: "Subject plus actor are exchanged.", kv: [["act", "agent-001"]] },
  },
  { id: "stepup", title: "Step-up required — HITL / MFA", lane: "AUTHZ", status: "notinpath", detail: {} },
];

const noop = () => {};

describe("TokenChainPresenter", () => {
  it("shows the active step at presenter size, with its position in the chain", () => {
    render(<TokenChainPresenter steps={STEPS} activeId="exchange" onSelect={noop} onClose={noop} />);
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Token exchange/ })).toBeInTheDocument();
    expect(screen.getByText("Subject plus actor are exchanged.")).toBeInTheDocument();
  });

  it("renders the step's own evidence rather than inventing any", () => {
    render(<TokenChainPresenter steps={STEPS} activeId="signin" onSelect={noop} onClose={noop} />);
    expect(screen.getByText("scope")).toBeInTheDocument();
    expect(screen.getByText("read write")).toBeInTheDocument();
    expect(screen.getByText("RFC 6749")).toBeInTheDocument();
  });

  it("states a step's status in words instead of colour alone", () => {
    render(<TokenChainPresenter steps={STEPS} activeId="stepup" onSelect={noop} onClose={noop} />);
    expect(screen.getByText("Not in this path")).toBeInTheDocument();
  });

  it("moves with the arrow keys", async () => {
    const onSelect = vi.fn();
    render(<TokenChainPresenter steps={STEPS} activeId="signin" onSelect={onSelect} onClose={noop} />);
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith("exchange");
  });

  it("does not run off either end of the chain", async () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <TokenChainPresenter steps={STEPS} activeId="signin" onSelect={onSelect} onClose={noop} />,
    );
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).not.toHaveBeenCalled();
    unmount();

    render(<TokenChainPresenter steps={STEPS} activeId="stepup" onSelect={onSelect} onClose={noop} />);
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape and on the close button", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TokenChainPresenter steps={STEPS} activeId="signin" onSelect={noop} onClose={onClose} />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(<TokenChainPresenter steps={STEPS} activeId="signin" onSelect={noop} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when the run produced no steps", () => {
    const { container } = render(
      <TokenChainPresenter steps={[]} activeId={null} onSelect={noop} onClose={noop} />,
    );
    expect(container.querySelector(".tcp")).toBeNull();
  });
});
