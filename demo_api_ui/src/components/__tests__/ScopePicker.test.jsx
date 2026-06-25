// demo_api_ui/src/components/__tests__/ScopePicker.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import ScopePicker from "../ScopePicker";

describe("ScopePicker", () => {
  it("keeps the Read only / Read + Write labels", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Read + Write" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Read only" })).toBeInTheDocument();
  });

  it("renders the explainer hint", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByText(/greys out write actions via PingOne Authorize/i)).toBeInTheDocument();
  });

  it("emits a boolean on change", () => {
    const onChange = vi.fn();
    render(<ScopePicker allowWrite onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ro" } });
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
