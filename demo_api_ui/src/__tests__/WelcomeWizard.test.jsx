import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import WelcomeWizard from "../components/WelcomeWizard";

vi.mock("../services/apiClient", () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

import apiClient from "../services/apiClient";

// Mock the tour context: start() records calls
const tourStart = vi.fn();
vi.mock("../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: tourStart }),
}));

function renderWizard(props = {}) {
  return render(
    <MemoryRouter>
      <WelcomeWizard open onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe("WelcomeWizard", () => {
  beforeEach(() => {
    localStorage.clear();
    tourStart.mockClear();
    sessionStorage.clear();
  });

  it("step 1 renders intro content and Next advances", () => {
    renderWizard();
    expect(screen.getByText(/Welcome to AI-DEMO2/i)).toBeInTheDocument();
    expect(screen.getByText(/governed AI agents/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/What it can do/i)).toBeInTheDocument();
  });

  it("collects email + cell on the setup step and posts to provision-wizard", async () => {
    renderWizard();
    // Advance to the setup step
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByLabelText(/ping email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cell/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/ping email/i), {
      target: { value: "se.new@pingidentity.com" },
    });
    fireEvent.change(screen.getByLabelText(/cell/i), {
      target: { value: "+12065550123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up my accounts" }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith("/api/demo/provision-wizard", {
        email: "se.new@pingidentity.com",
        cell: "+12065550123",
      });
    });
  });

  it("shows both usernames and temp password after provisioning", async () => {
    apiClient.post.mockResolvedValueOnce({
      data: {
        credentials: {
          customerUsername: "se.new@pingidentity.com",
          adminUsername: "se.new+admin@pingidentity.com",
          password: "TempPass123",
        },
        errors: undefined,
      },
    });
    renderWizard();
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/ping email/i), { target: { value: "se.new@pingidentity.com" } });
    fireEvent.change(screen.getByLabelText(/cell/i), { target: { value: "+12065550123" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up my accounts" }));

    await waitFor(() => {
      expect(screen.getByText("se.new@pingidentity.com")).toBeInTheDocument();
      expect(screen.getByText("se.new+admin@pingidentity.com")).toBeInTheDocument();
      expect(screen.getByText("TempPass123")).toBeInTheDocument();
    });
  });

  it("final step hands off to the guided demo tour", () => {
    renderWizard();
    // Advance: 2 Nexts to reach provision step, skip it (Next is gated until
    // provisioned), then 4 more Nexts to the last step
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip — provision later" }));
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: /guided tour/i }));
    expect(tourStart).toHaveBeenCalled();
  });

  it("skip sets the seen flag and closes", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <WelcomeWizard open onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(localStorage.getItem("demo_welcome_seen")).toBe("1");
    expect(onClose).toHaveBeenCalled();
  });
});
