import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import AgentNoMatchCard, {
  noMatchSubject,
  verticalDisplayName,
} from "../AgentNoMatchCard";

const suggestions = [
  { id: "hc1", label: "View my care plan", message: "show my care plan", tool: "care_plan" },
  { id: "hc2", label: "Book an appointment", message: "book an appointment", tool: "book_appt" },
];

describe("AgentNoMatchCard", () => {
  it("names the failure, the brand and the vertical in the heading", () => {
    const { container } = render(
      <AgentNoMatchCard
        verticalId="healthcare"
        brandName="CareConnect"
        intentsConsidered={8}
        suggestions={suggestions}
      />,
    );
    expect(container.querySelector(".ba-nomatch-head")).toHaveTextContent(
      "No matching action in CareConnect (Healthcare)",
    );
  });

  it("falls back to the vertical alone when the manifest has no brand", () => {
    const { container } = render(
      <AgentNoMatchCard verticalId="healthcare" intentsConsidered={8} suggestions={suggestions} />,
    );
    const head = container.querySelector(".ba-nomatch-head");
    expect(head).toHaveTextContent("No matching action in Healthcare");
    expect(head.textContent).not.toMatch(/[()]/);
    expect(head.textContent).not.toMatch(/undefined|null/);
  });

  it("does not render empty parentheses for a blank brand", () => {
    const { container } = render(
      <AgentNoMatchCard
        verticalId="healthcare"
        brandName="   "
        intentsConsidered={8}
        suggestions={suggestions}
      />,
    );
    expect(container.querySelector(".ba-nomatch-head").textContent).not.toMatch(/[()]/);
  });

  it("does not repeat a brand that is already the vertical name", () => {
    const { container } = render(
      <AgentNoMatchCard
        verticalId="investment"
        brandName="Investment"
        intentsConsidered={4}
        suggestions={[]}
      />,
    );
    expect(container.querySelector(".ba-nomatch-head")).toHaveTextContent(
      "No matching action in Investment",
    );
    expect(container.querySelector(".ba-nomatch-head").textContent).not.toMatch(/[()]/);
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

  it("keeps the title-cased vertical inside the parentheses", () => {
    expect(noMatchSubject("sporting-goods", "Peak Outfitters")).toBe(
      "Peak Outfitters (Sporting Goods)",
    );
    expect(noMatchSubject("sporting-goods", null)).toBe("Sporting Goods");
    expect(noMatchSubject("sporting-goods", undefined)).toBe("Sporting Goods");
    // No vertical means nothing scoped the refusal — a brand alone would misstate it.
    expect(noMatchSubject(null, "CareConnect")).toBeNull();
  });
});

/**
 * Option C reuses this card's layout for a DIFFERENT failure: the request
 * routed fine and the agent answered, but nothing in the answer could be traced
 * to a tool call. The layout is shared; the wording must not be. A refactor that
 * collapses the two back into one message has to fail here.
 */
describe("AgentNoMatchCard — ungrounded variant", () => {
  function headAndWhy(props) {
    const { container, unmount } = render(<AgentNoMatchCard {...props} />);
    const out = {
      head: container.querySelector(".ba-nomatch-head").textContent,
      why: container.querySelector(".ba-nomatch-why").textContent,
    };
    unmount();
    return out;
  }

  const identity = { verticalId: "banking", brandName: "Super Banking" };

  it("renders copy distinguishable from the no-match case", () => {
    const noMatch = headAndWhy({ ...identity });
    const ungrounded = headAndWhy({ ...identity, reason: "ungrounded" });

    expect(ungrounded.head).not.toBe(noMatch.head);
    expect(ungrounded.why).not.toBe(noMatch.why);
  });

  it("does not claim the request failed to match — an action DID match", () => {
    const { head, why } = headAndWhy({ ...identity, reason: "ungrounded" });

    expect(head).not.toMatch(/No matching action/);
    expect(why).not.toMatch(/has no action for that request/);
    expect(why).not.toMatch(/another vertical's data/);
  });

  it("names the failure as verification and still names the subject", () => {
    const { head, why } = headAndWhy({ ...identity, reason: "ungrounded" });

    expect(head).toContain("No verified answer in Super Banking (Banking)");
    expect(why).toMatch(/none of the answer could be traced back to a tool call in Banking/);
    expect(why).toMatch(/it is not shown/);
  });

  it("states the dropped count when the server counted it", () => {
    const { container } = render(
      <AgentNoMatchCard {...identity} reason="ungrounded" droppedCount={3} />,
    );
    expect(screen.getByText("Statements dropped")).toBeInTheDocument();
    expect(container.querySelector(".ba-nomatch-diag")).toHaveTextContent("3");
  });

  it("omits the dropped count rather than guessing when the server sent none", () => {
    render(<AgentNoMatchCard {...identity} reason="ungrounded" />);
    expect(screen.queryByText("Statements dropped")).not.toBeInTheDocument();
  });

  it("hides 'Intents considered' — routing succeeded, so it points at the wrong failure", () => {
    render(<AgentNoMatchCard {...identity} reason="ungrounded" intentsConsidered={8} />);
    expect(screen.queryByText("Intents considered")).not.toBeInTheDocument();
  });

  it("still offers the active vertical's own suggestions", () => {
    render(
      <AgentNoMatchCard {...identity} reason="ungrounded" suggestions={suggestions} />,
    );
    expect(screen.getByRole("button", { name: "Book an appointment" })).toBeInTheDocument();
  });
});
