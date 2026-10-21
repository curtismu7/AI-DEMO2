import React from "react";
import { render, screen } from "@testing-library/react";
import SequenceActorHeader, { initialsOf } from "../SequenceActorHeader";

describe("SequenceActorHeader", () => {
  it("derives initials from one or more words", () => {
    expect(initialsOf("User Browser")).toBe("UB");
    expect(initialsOf("AIC")).toBe("AI");
    expect(initialsOf("")).toBe("?");
  });

  it("renders each actor with name, description and badge, and marks its state", () => {
    render(
      <SequenceActorHeader
        actors={[
          { id: "a", name: "User Browser", description: "transient", badge: "P7", state: "active" },
          { id: "b", name: "Bank Core", state: "idle" },
        ]}
        segments={[{ state: "done" }, { state: "idle" }]}
      />
    );
    expect(screen.getByText("UB")).toBeInTheDocument();
    expect(screen.getByText("transient")).toBeInTheDocument();
    expect(screen.getByText("P7")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-state", "active");
    expect(items[1]).toHaveAttribute("data-state", "idle");
  });

  it("omits the progress bar when there are no segments", () => {
    const { container } = render(<SequenceActorHeader actors={[{ id: "a", name: "A" }]} />);
    expect(container.querySelector(".sah__bar")).toBeNull();
  });
});
