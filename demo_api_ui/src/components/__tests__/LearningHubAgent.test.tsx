import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LearningHubAgent from "../LearningHubAgent";

vi.mock("../../services/codeSearchAPI", () => ({ askCodeSearch: vi.fn() }));
import { askCodeSearch } from "../../services/codeSearchAPI";
import { MemoryRouter } from "react-router-dom";

describe("LearningHubAgent", () => {
  it("offers ten prompts and restores previous prompts with ArrowUp", async () => {
    askCodeSearch.mockResolvedValue({ answer: "OAuth summary", sources: [] });
    render(<LearningHubAgent />);
    fireEvent.click(screen.getByText(/Prompt library/));
    expect(screen.getAllByRole("button")).toHaveLength(11);
    const input = screen.getByLabelText("Ask the Learning Hub agent");
    fireEvent.change(input, { target: { value: "first question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("OAuth summary")).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "second question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("second question");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("first question");
  });
});
