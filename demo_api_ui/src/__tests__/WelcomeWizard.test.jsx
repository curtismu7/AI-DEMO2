import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import WelcomeWizard from "../components/WelcomeWizard";
import apiClient from "../services/apiClient";

vi.mock("../services/apiClient", () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

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
    apiClient.post.mockClear();
  });

  it("step 1 renders intro content and Next advances", () => {
    renderWizard();
    expect(screen.getByText(/Welcome to AI-DEMO2/i)).toBeInTheDocument();
    expect(screen.getByText(/governed AI agents/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    expect(screen.getByText(/What it can do/i)).toBeInTheDocument();
  });

  it("collects email + cell on the setup step and posts to provision-wizard", async () => {
    renderWizard();
    for (let i = 0; i < 2; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.change(screen.getByLabelText(/ping email/i), { target: { value: "se.new@pingidentity.com" } });
    fireEvent.change(screen.getByLabelText(/cell/i), { target: { value: "+12065550123" } });
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
      },
    });
    renderWizard();
    for (let i = 0; i < 2; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.change(screen.getByLabelText(/ping email/i), { target: { value: "se.new@pingidentity.com" } });
    fireEvent.change(screen.getByLabelText(/cell/i), { target: { value: "+12065550123" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up my accounts" }));

    await waitFor(() => {
      expect(screen.getByText("se.new@pingidentity.com")).toBeInTheDocument();
      expect(screen.getByText("se.new+admin@pingidentity.com")).toBeInTheDocument();
      expect(screen.getByText("TempPass123")).toBeInTheDocument();
    });
  });

  it("clicking an action link docks the wizard instead of closing it", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    const link = screen.getByRole("link", { name: /Browse all use cases/ });
    fireEvent.click(link);
    // Wizard stays mounted, now docked (no backdrop, expand control present)
    expect(screen.getByRole("dialog", { name: /welcome wizard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    expect(document.querySelector(".ww-backdrop")).toBeNull();
    // and it did NOT mark seen
    expect(localStorage.getItem("demo_welcome_seen")).toBeNull();
  });

  it("expand returns the docked wizard to the modal", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("link", { name: /Browse all use cases/ }));
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(document.querySelector(".ww-backdrop")).not.toBeNull();
  });

  it("navigating after docking preserves the current step", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Next ›" })); // step 2
    fireEvent.click(screen.getByRole("link", { name: /Browse all use cases/ })); // dock on step 2
    // Docked card shows the same step's content (no Next in dock mode — Expand owns advancement)
    expect(screen.getByText(/What it can do/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Next ›" })); // step 3 in modal
    expect(screen.getByText(/Set up your demo accounts/i)).toBeInTheDocument();
  });

  it("explicit close sets the seen flag", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <WelcomeWizard open onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close welcome wizard/i }));
    expect(localStorage.getItem("demo_welcome_seen")).toBe("1");
    expect(onClose).toHaveBeenCalled();
  });

  it("final step hands off to the guided demo tour", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip — provision later" }));
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
    fireEvent.click(screen.getByRole("button", { name: /guided tour/i }));
    expect(tourStart).toHaveBeenCalled();
  });
});
