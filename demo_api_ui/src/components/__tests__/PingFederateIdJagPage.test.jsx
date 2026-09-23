import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EducationRoutes from "../../routes/EducationRoutes";

vi.mock("../../routes/AppShell", () => ({ default: ({ children }) => children }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/architecture/pingfederate-id-jag"]}>
      <Routes>
        <Route path="/architecture/*" element={<EducationRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PingFederate ID-JAG architecture", () => {
  it("renders both interactive React Flow views", () => {
    const { container } = renderPage();
    expect(screen.getByRole("tab", { name: "ID-JAG flow" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("ID-JAG token journey")).toBeTruthy();
    expect(container.querySelector(".react-flow")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate architecture" }));
    expect(screen.getByText("PingFederate in the system")).toBeTruthy();
    expect(screen.getByText("Generalist agent")).toBeTruthy();
  });

  it("steps through the ID-JAG issuance and exchange narrative", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Exchange 1 issues an ID-JAG" }));
    expect(screen.getByText("Exchange 1 issues an ID-JAG")).toBeTruthy();
    expect(screen.getByText(/user remains sub/)).toBeTruthy();
  });
});
