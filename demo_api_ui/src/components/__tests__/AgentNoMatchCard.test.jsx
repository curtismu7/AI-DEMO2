import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import AgentNoMatchCard, { verticalDisplayName } from "../AgentNoMatchCard";

const suggestions = [
  { id: "hc1", label: "View my care plan", message: "show my care plan", tool: "care_plan" },
  { id: "hc2", label: "Book an appointment", message: "book an appointment", tool: "book_appt" },
];

describe("AgentNoMatchCard", () => {
  it("names the failure and the active vertical in the heading", () => {
    render(<AgentNoMatchCard verticalId="healthcare" intentsConsidered={8} suggestions={suggestions} />);
    expect(screen.getByText(/No matching action in Healthcare/)).toBeInTheDocument();
  });

  it("explains that another vertical's data will not be used", () => {
    render(<AgentNoMatchCard verticalId="healthcare" intentsConsidered={8} suggestions={suggestions} />);
    expect(
      screen.getByText(/will not answer it using another vertical's data/i),
    ).toBeInTheDocument();
  });

  it("renders the vertical and intent-count diagnostics the server sent", () => {
    render(<AgentNoMatchCard verticalId="healthcare" intentsConsidered={8} suggestions={suggestions} />);
    expect(screen.getByText("Vertical")).toBeInTheDocument();
    expect(screen.getByText("healthcare")).toBeInTheDocument();
    expect(screen.getByText("Intents considered")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("omits closest candidate when the server does not send one", () => {
    render(<AgentNoMatchCard verticalId="healthcare" intentsConsidered={8} suggestions={suggestions} />);
    expect(screen.queryByText("Closest candidate")).not.toBeInTheDocument();
  });

  it("renders closest candidate only when the server sends one", () => {
    render(
      <AgentNoMatchCard
        verticalId="healthcare"
        intentsConsidered={8}
        closestCandidate="view_care_plan"
        suggestions={suggestions}
      />,
    );
    expect(screen.getByText("Closest candidate")).toBeInTheDocument();
    expect(screen.getByText("view_care_plan")).toBeInTheDocument();
  });

  it("renders a clickable chip per suggestion and dispatches the one clicked", () => {
    const onSelect = vi.fn();
    render(
      <AgentNoMatchCard
        verticalId="healthcare"
        intentsConsidered={8}
        suggestions={suggestions}
        onSelect={onSelect}
      />,
    );
    const chip = screen.getByRole("button", { name: "Book an appointment" });
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(suggestions[1]);
  });

  it("suppresses the suggestion block when the vertical has no chips", () => {
    render(<AgentNoMatchCard verticalId="healthcare" intentsConsidered={0} suggestions={[]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("says no vertical is active when the server reports none", () => {
    const { container } = render(
      <AgentNoMatchCard verticalId={null} intentsConsidered={0} suggestions={[]} />,
    );
    expect(container.querySelector(".ba-nomatch-head")).toHaveTextContent(
      "No vertical is active",
    );
    expect(screen.queryByText("Vertical")).not.toBeInTheDocument();
  });

  it("title-cases hyphenated vertical ids", () => {
    expect(verticalDisplayName("sporting-goods")).toBe("Sporting Goods");
    expect(verticalDisplayName("banking")).toBe("Banking");
    expect(verticalDisplayName(null)).toBeNull();
  });
});
