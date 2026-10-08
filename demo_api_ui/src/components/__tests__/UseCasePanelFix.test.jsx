import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import UseCaseDiagramPage from "../UseCaseDiagramPage";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// Finding 3 fix: UC6's guide entry vanishes — page must render with empty
// description and the id as title, no crash (file-scoped mock).
vi.mock("../../config/demoStepGuides", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, DEMO_STEP_GUIDES: { ...actual.DEMO_STEP_GUIDES, UC6: undefined } };
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/use-case-diagrams" element={<div />} />
        <Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("hop panel rendering (review findings 1+3)", () => {
  it("shows the hop label in the header and the line text exactly once", () => {
    renderAt("/use-case-diagrams/UC1");
    const panel = screen.getByTestId("ucd-panel").textContent;
    expect(panel).toContain("— Alice's authority, explicitly granted"); // hop label from data
    const hits = panel.split("Sign-in consent is what authorizes everything that follows.").length - 1;
    expect(hits).toBe(1);
  });

  it("missing guide id renders empty description with id as title, no crash", () => {
    renderAt("/use-case-diagrams/UC6");
    expect(screen.getByTestId("ucd-title").textContent).toBe("UC6"); // falls back to id
    expect(screen.getByTestId("ucd-desc").textContent).toBe("");
  });
});
