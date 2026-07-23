// demo_api_ui/src/components/__tests__/ScopePicker.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import ScopePicker from "../ScopePicker";

describe("ScopePicker", () => {
  it("keeps the Read / Write toggle labels", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Read" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write" })).toBeInTheDocument();
  });

  it("renders the explainer hint", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByText(/greys out write actions via PingOne Authorize/i)).toBeInTheDocument();
  });

  it("emits a boolean on toggle", () => {
    const onChange = vi.fn();
    render(<ScopePicker allowWrite onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
