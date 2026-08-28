/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/no-render-in-setup */
/* eslint-disable testing-library/prefer-find-by */
/* eslint-disable testing-library/no-wait-for-multiple-assertions */
/* eslint-disable testing-library/no-wait-for-side-effects */
/* eslint-disable testing-library/no-container */
/**
 * Tests for PingOneAudit React Component
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import apiClient from "../../services/apiClient";
import PingOneAudit from "../PingOneAudit";

vi.mock("../../services/apiClient", () => ({
	default: {
		get: jest.fn(() => Promise.resolve({ data: {} })),
		post: jest.fn(() => Promise.resolve({ data: {} })),
	},
}));

describe("PingOneAudit Component", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("Initial State", () => {
		it('should render initial state with "Run Audit" button', () => {
			render(<PingOneAudit />);

			expect(screen.getByText(/Click/i)).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "Run Audit" }),
			).toBeInTheDocument();
		});

		it("should display component title", () => {
			render(<PingOneAudit />);

			expect(
				screen.getByText("PingOne Configuration Audit"),
			).toBeInTheDocument();
		});
	});

	describe("Loading State", () => {
		it("should show loading spinner while fetching audit", async () => {
			apiClient.get.mockImplementation(
				() => new Promise(() => {}), // Never resolves
			);

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			expect(
				screen.getByText(/Auditing PingOne resources and scopes/),
			).toBeInTheDocument();
		});
	});

	describe("Success State", () => {
		it("should display resource validation table", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [
					{
						resourceName: "Super Banking AI Agent",
						audienceUri: "agentgateway.ping.demo",
						authMethod: "CLIENT_CREDENTIALS",
						status: "CORRECT",
					},
				],
				scopeAudit: [],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText("Resource Configuration")).toBeInTheDocument();
				expect(screen.getByText("Super Banking AI Agent")).toBeInTheDocument();
			});
		});

		it("should display scope audit table", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [],
				scopeAudit: [
					{
						resourceName: "Super Banking AI Agent",
						expectedScopes: ["banking:ai:agent"],
						currentScopes: ["banking:ai:agent"],
						status: "CORRECT",
					},
				],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText("Scope Audit")).toBeInTheDocument();
				expect(screen.getAllByText("banking:ai:agent").length).toBeGreaterThan(0);
			});
		});

		it("should display audit timestamp", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [],
				scopeAudit: [],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText(/Last run:/)).toBeInTheDocument();
			});
		});

		it("should show status badges with correct colors", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [
					{
						resourceName: "Super Banking AI Agent",
						audienceUri: "agentgateway.ping.demo",
						authMethod: "CLIENT_CREDENTIALS",
						status: "CORRECT",
					},
					{
						resourceName: "Missing Resource",
						audienceUri: null,
						authMethod: null,
						status: "MISSING",
					},
				],
				scopeAudit: [],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText("CORRECT")).toBeInTheDocument();
				expect(screen.getByText("MISSING")).toBeInTheDocument();
			});
		});

		it("should display summary stats", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [
					{
						resourceName: "Super Banking AI Agent",
						audienceUri: "agentgateway.ping.demo",
						authMethod: "CLIENT_CREDENTIALS",
						status: "CORRECT",
					},
				],
				scopeAudit: [
					{
						resourceName: "Super Banking AI Agent",
						expectedScopes: ["banking:ai:agent"],
						currentScopes: ["banking:ai:agent"],
						status: "CORRECT",
					},
				],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText(/Resources Correct:/)).toBeInTheDocument();
				expect(screen.getByText(/Scopes Correct:/)).toBeInTheDocument();
			});
		});
	});

	describe("Error State", () => {
		it("should show error message when API call fails", async () => {
			apiClient.get.mockRejectedValueOnce(new Error("API Error"));

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText(/API Error/)).toBeInTheDocument();
			});
		});

		it("should show authentication error message", async () => {
			const error = new Error("Unauthorized");
			error.response = { status: 401 };
			apiClient.get.mockRejectedValueOnce(error);

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText(/Sign in to view audit results/)).toBeInTheDocument();
			});
		});

		it("should display Retry button on error", async () => {
			apiClient.get.mockRejectedValueOnce(new Error("API Error"));

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText("Retry Audit")).toBeInTheDocument();
			});
		});
	});

	describe("Refresh Functionality", () => {
		it("should refresh audit results when button clicked", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [],
				scopeAudit: [],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText("Refresh Audit")).toBeInTheDocument();
			});

			// Reset mock and make another call
			jest.clearAllMocks();
			apiClient.get.mockResolvedValueOnce({ data: mockData });

			fireEvent.click(screen.getByText("Refresh Audit"));

			await waitFor(() => {
				expect(apiClient.get).toHaveBeenCalledWith("/api/pingone/audit");
			});
		});
	});

	describe("Scope Mismatch Display", () => {
		it("should display missing and extra scopes in mismatch details", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [],
				scopeAudit: [
					{
						resourceName: "Super Banking MCP Server",
						expectedScopes: ["banking:read", "banking:read"],
						currentScopes: ["banking:read", "extra:scope"],
						status: "MISMATCH",
						mismatches: {
							missing: ["banking:read"],
							extra: ["extra:scope"],
						},
					},
				],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(screen.getByText(/Missing:/)).toBeInTheDocument();
				expect(screen.getByText(/Extra:/)).toBeInTheDocument();
			});
		});
	});

	describe("Empty Results", () => {
		it("should show empty message when no resources found", async () => {
			const mockData = {
				status: "success",
				auditedAt: "2024-01-15T10:30:00Z",
				resourceValidation: [],
				scopeAudit: [],
			};

			apiClient.get.mockResolvedValueOnce({ data: mockData });

			render(<PingOneAudit />);
			fireEvent.click(screen.getByRole("button", { name: /run audit/i }));

			await waitFor(() => {
				expect(
					screen.getByText(/No resources found in audit results/),
				).toBeInTheDocument();
			});
		});
	});
});
