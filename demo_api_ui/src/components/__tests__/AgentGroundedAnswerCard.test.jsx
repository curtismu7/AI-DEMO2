import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import AgentGroundedAnswerCard from "../AgentGroundedAnswerCard";

const claims = [
  {
    text: "Your checking balance is $1,234.50.",
    sources: [{ tool: "get_account_balance", scope: "read" }],
  },
  {
    text: "You have 3 recent transactions.",
    sources: [{ tool: "get_my_transactions", scope: "read" }],
  },
];

describe("AgentGroundedAnswerCard", () => {
  test("renders every claim with the tool and scope behind it", () => {
    render(<AgentGroundedAnswerCard claims={claims} />);

    expect(screen.getByText("Your checking balance is $1,234.50.")).toBeInTheDocument();
    expect(screen.getByText("You have 3 recent transactions.")).toBeInTheDocument();
    expect(screen.getByText("get_account_balance")).toBeInTheDocument();
    expect(screen.getByText("get_my_transactions")).toBeInTheDocument();
    expect(screen.getAllByText("scope: read")).toHaveLength(2);
  });

  test("omits the scope line rather than inventing one when the server sent null", () => {
    render(
      <AgentGroundedAnswerCard
        claims={[{ text: "The widget count is 8817.", sources: [{ tool: "odd_tool", scope: null }] }]}
      />,
    );

    expect(screen.getByText("odd_tool")).toBeInTheDocument();
    expect(screen.queryByText(/scope:/)).not.toBeInTheDocument();
  });

  test("states how many claims were dropped, without showing any of their text", () => {
    const { container } = render(<AgentGroundedAnswerCard claims={claims} droppedCount={2} />);

    expect(
      screen.getByText(/2 statements were dropped because no tool call supported them\./),
    ).toBeInTheDocument();
    // Only the two grounded claims are present as claim text.
    expect(container.querySelectorAll(".ba-grounded-claim-text")).toHaveLength(2);
  });

  test("singular wording for a single dropped claim", () => {
    render(<AgentGroundedAnswerCard claims={claims} droppedCount={1} />);
    expect(
      screen.getByText(/1 statement was dropped because no tool call supported it\./),
    ).toBeInTheDocument();
  });

  test("no dropped notice when nothing was dropped", () => {
    render(<AgentGroundedAnswerCard claims={claims} />);
    expect(screen.queryByText(/dropped/)).not.toBeInTheDocument();
  });

  test("renders nothing at all for zero claims — the caller degrades to the no-match card", () => {
    const { container } = render(<AgentGroundedAnswerCard claims={[]} droppedCount={4} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when claims is missing entirely", () => {
    const { container } = render(<AgentGroundedAnswerCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
