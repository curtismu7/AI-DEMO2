import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import LearningProtocolLabPage from "../LearningProtocolLabPage";

function renderLab(lab) {
  return render(
    <MemoryRouter initialEntries={[`/learning-lab/${lab}`]}>
      <Routes>
        <Route path="/learning-lab/:lab" element={<LearningProtocolLabPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LearningProtocolLabPage", () => {
  it("runs the PAR mock and produces a request URI", () => {
    renderLab("par");

    expect(screen.getByRole("heading", { name: /PAR protocol lab/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /push authorization request/i }));

    expect(screen.getByText(/request_uri created/i)).toBeInTheDocument();
    expect(screen.getByText(/urn:example:par:/i)).toBeInTheDocument();
  });

  it("evaluates RAR amount changes as a deterministic authorization result", () => {
    renderLab("rar");

    expect(screen.getByText(/decision: permit/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1250" } });

    expect(screen.getByText(/decision: step-up/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /evaluate authorization details/i }));
    expect(screen.getByText(/decision: step-up/i)).toBeInTheDocument();
  });

  it("validates a JWT client assertion and shows a failure for a bad issuer", () => {
    renderLab("jwt-client-auth");

    fireEvent.click(screen.getByRole("button", { name: /validate assertion/i }));
    expect(screen.getByText(/assertion accepted/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /use invalid issuer/i }));
    fireEvent.click(screen.getByRole("button", { name: /validate assertion/i }));
    expect(screen.getByText(/issuer rejected/i)).toBeInTheDocument();
  });

  it("requires and completes a step-up challenge for a high-value action", () => {
    renderLab("step-up");

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: /evaluate transfer/i }));
    expect(screen.getByText(/step-up required/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /approve step-up/i }));
    expect(screen.getByText(/transfer permitted after step-up/i)).toBeInTheDocument();
  });

  it("does not silently turn an unknown lab into the PAR lab", () => {
    renderLab("not-a-real-lab");

    expect(screen.getByRole("heading", { name: /training lab not found/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /push authorization request/i })).not.toBeInTheDocument();
  });
});
