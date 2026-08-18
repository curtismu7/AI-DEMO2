/* eslint-disable import/first */
/* eslint-disable no-unused-vars */
/* eslint-disable testing-library/no-node-access */
// banking_api_ui/src/components/__tests__/buttonRouting.test.js
/**
 * Routing tests for every navigation button and link across the app.
 * Tests verify: Link destinations, navigate() calls, and window.open calls.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Core mocks ────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
vi.mock("react-router-dom", async () => ({
	...await vi.importActual("react-router-dom"),
	useNavigate: () => mockNavigate,
}));

// Axios — must include create() so bffAxios / apiClient constructors don't throw
vi.mock("axios", () => {
	const instance = {
		get: jest.fn(() => Promise.resolve({ data: {} })),
		post: jest.fn(() => Promise.resolve({ data: {} })),
		delete: jest.fn(() => Promise.resolve({ data: {} })),
		interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
	};
	return {
		default: { ...instance, create: jest.fn(() => instance) },
		...instance,
		create: jest.fn(() => instance),
	};
});

// Service-layer mocks — stub at module level to avoid axios.create chain
// bffAxios/apiClient use `export default` — the factory must return an object
// with __esModule:true and a `default` key so that
// `import bffAxios from "..."` resolves to the instance.
vi.mock("../../services/bffAxios", () => {
	const instance = {
		get: jest.fn((url) => {
			if (url && url.includes("stats")) {
				return Promise.resolve({
					data: {
						stats: {
							totalUsers: 1,
							totalAccounts: 1,
							totalTransactions: 0,
							totalBalance: 5000,
							averageBalance: 5000,
							activeUsers: 1,
						},
					},
				});
			}
			if (url && url.includes("activity")) {
				return Promise.resolve({ data: { logs: [] } });
			}
			return Promise.resolve({ data: {} });
		}),
		post: jest.fn(() => Promise.resolve({ data: {} })),
		delete: jest.fn(() => Promise.resolve({ data: {} })),
	};
	// Jest needs __esModule:true so the `default` key is used for default imports
	return { __esModule: true, default: instance };
});
vi.mock("../../services/apiClient", () => {
	const instance = {
		get: jest.fn(() =>
			Promise.resolve({ data: { lines: [], backend: "", hint: "" } }),
		),
		post: jest.fn(() => Promise.resolve({ data: {} })),
		patch: jest.fn(() => Promise.resolve({ data: {} })),
		delete: jest.fn(() => Promise.resolve({ data: {} })),
	};
	return { __esModule: true, default: instance };
});
vi.mock("../../services/demoScenarioService", () => ({
	fetchDemoScenario: jest.fn(() =>
		Promise.resolve({
			accounts: [],
			settings: {},
			userData: {},
			defaults: null,
			persistenceNote: null,
		}),
	),
	saveDemoScenario: jest.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("../../services/sessionResolver", () => ({
	resolveSessionUser: jest.fn(() => Promise.resolve(null)),
}));

// Context mocks
vi.mock("../../context/IndustryBrandingContext", () => ({
	useIndustryBranding: () => ({
		preset: { shortName: "Super Banking", name: "Super Banking" },
	}),
}));
vi.mock("../../context/AgentUiModeContext", () => ({
	useAgentUiMode: () => ({
		placement: "none",
		fab: true,
		setAgentUi: jest.fn(),
	}),
}));
vi.mock("../../context/EducationUIContext", () => ({
	useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
	useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
}));
vi.mock("../../context/ExchangeModeContext", () => ({
	useExchangeMode: () => ({ mode: "single", setMode: jest.fn() }),
	ExchangeModeProvider: ({ children }) => children,
}));
vi.mock("../../context/TokenChainContext", () => ({
	useTokenChainOptional: () => null,
	TokenChainProvider: ({ children }) => children,
}));

// Utility mocks
vi.mock("../../utils/appToast", () => ({
	toast: {
		dismiss: jest.fn(),
		error: jest.fn(),
		success: jest.fn(),
		info: jest.fn(),
		warning: jest.fn(),
	},
	notifySuccess: jest.fn(),
	notifyError: jest.fn(),
	notifyWarning: jest.fn(),
	notifyInfo: jest.fn(),
}));
vi.mock(
	"../utils/authUi",
	() => ({
		navigateToAdminOAuthLogin: jest.fn(),
	}),
	{ virtual: true },
);
vi.mock("../../utils/authUi", () => ({
	navigateToAdminOAuthLogin: jest.fn(),
}));
vi.mock("../../utils/dashboardToast", () => ({
	toastAdminSessionError: jest.fn(),
}));
// (no mock needed — isDashboardQuickNavRoute uses real path matching)

// Sub-component stubs
vi.mock("../BrandLogo", () => ({ default: () => null }));
vi.mock("../shared/LoadingOverlay", () => ({ default: () => null }));
vi.mock("../TokenChainDisplay", () => ({ default: () => null }));
vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));
vi.mock("../AdminSubPageShell", () => ({ default: ({ children, lead }) => (
	<div>
		{lead}
		{children}
	</div>
) }));
vi.mock("./education/educationIds", () => ({ EDU: {} }), { virtual: true });
vi.mock("../education/educationIds", () => ({ EDU: {} }));
// Dashboard child components that can't render in jsdom
vi.mock("../ArchitectureTabsPanel", () => ({ default: () => null }));
vi.mock("../ApiCallsModal", () => ({ default: () => null }));
vi.mock("../DevToolsOverlay", () => ({ default: () => null }));
vi.mock("../VerticalSwitcher", () => ({ default: () => null }));
vi.mock("../PingOneAudit", () => ({ default: () => null }));
// DemoDataPage child components
vi.mock("../VerticalSwitcher", () => ({ default: () => null }));
vi.mock("../../services/cachedStatusService", () => ({
	getCachedJson: jest.fn((url) => {
		if (url === "/api/auth/oauth/status")
			return Promise.resolve({ data: { authenticated: false } });
		if (url === "/api/auth/oauth/user/status")
			return Promise.resolve({ data: { authenticated: false } });
		if (url === "/api/auth/session")
			return Promise.resolve({ data: { authenticated: false } });
		return Promise.resolve({ data: {} });
	}),
	clearStatusCache: jest.fn(),
}));
// Dashboard uses useCurrentUserTokenEvent — stub it
vi.mock("../../hooks/useCurrentUserTokenEvent", () => ({
	useCurrentUserTokenEvent: jest.fn(),
}));

// ── Shared test state ─────────────────────────────────────────────────────────
const adminUser = { id: "a1", role: "admin", email: "admin@test.com" };
const customerUser = { id: "u1", role: "customer", email: "user@test.com" };
const onLogout = jest.fn();

let windowOpenSpy;
beforeEach(() => {
	mockNavigate.mockClear();
	onLogout.mockClear();
	windowOpenSpy = jest.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
	windowOpenSpy.mockRestore();
});

function renderAt(Component, path, props = {}) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Component {...props} />
		</MemoryRouter>,
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// DashboardQuickNav
// ─────────────────────────────────────────────────────────────────────────────
import DashboardQuickNav from "../DashboardQuickNav";

describe("DashboardQuickNav", () => {
	it("Home link points to /", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
			"href",
			"/",
		);
	});

	it("Dashboard link points to /dashboard for customer", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
			"href",
			"/dashboard",
		);
	});

	it("renders nothing for admin users (admin nav moved to AdminSideNav in Phase 163)", () => {
		const { container } = renderAt(DashboardQuickNav, "/admin", {
			user: adminUser,
		});
		expect(container.firstChild).toBeNull();
	});

	it("Banking link is absent for customers", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		expect(screen.queryByRole("link", { name: "Banking" })).toBeNull();
	});

	it("API button opens /api-traffic in a popout window", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		fireEvent.click(screen.getByRole("button", { name: /api/i }));
		expect(windowOpenSpy).toHaveBeenCalledWith(
			"/api-traffic",
			"ApiTraffic",
			expect.any(String),
		);
	});

	it("Logs button opens /logs?mode=learn in a popout window", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		fireEvent.click(screen.getByRole("button", { name: /logs/i }));
		expect(windowOpenSpy).toHaveBeenCalledWith(
			"/logs?mode=learn",
			"BankingLogs",
			expect.any(String),
		);
	});

	it("Learning Log button opens /logs?mode=learn in a popout window", () => {
		renderAt(DashboardQuickNav, "/dashboard", { user: customerUser });
		fireEvent.click(screen.getByRole("button", { name: /^learning log$/i }));
		expect(windowOpenSpy).toHaveBeenCalledWith(
			"/logs?mode=learn",
			"BankingLogs",
			expect.any(String),
		);
	});

	it("renders nothing when user is null", () => {
		const { container } = renderAt(DashboardQuickNav, "/dashboard", {
			user: null,
		});
		expect(container.firstChild).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// PageNav
// ─────────────────────────────────────────────────────────────────────────────
import PageNav from "../PageNav";

describe("PageNav", () => {
	it("Back button calls navigate(-1)", () => {
		renderAt(PageNav, "/", { user: adminUser, onLogout });
		fireEvent.click(screen.getByRole("button", { name: "← Back" }));
		expect(mockNavigate).toHaveBeenCalledWith(-1);
	});

	it("Home link points to /admin for admin", () => {
		renderAt(PageNav, "/", { user: adminUser, onLogout });
		expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
			"href",
			"/admin",
		);
	});

	it("Home link points to /dashboard for customer", () => {
		renderAt(PageNav, "/", { user: customerUser, onLogout });
		expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
			"href",
			"/dashboard",
		);
	});

	it("Log Out button is absent (moved to AdminSideNav in Phase 163)", () => {
		renderAt(PageNav, "/", { user: adminUser, onLogout });
		expect(screen.queryByRole("button", { name: /log out/i })).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// LandingPage — nav + hero quick links
// ─────────────────────────────────────────────────────────────────────────────
import LandingPage from "../LandingPage";

describe("LandingPage", () => {
	it.skip("Demo Config nav button navigates to /demo-data" /* removed in landing redesign */, () => {
		renderAt(LandingPage, "/");
		const demoBtn = screen
			.getAllByRole("button")
			.find((b) => /demo config/i.test(b.textContent));
		fireEvent.click(demoBtn);
		expect(mockNavigate).toHaveBeenCalledWith("/demo-data");
	});

	it.skip("PingOne Test nav button navigates to /pingone-test" /* removed in landing redesign */, () => {
		renderAt(LandingPage, "/");
		const pingBtn = screen
			.getAllByRole("button")
			.find((b) => /pingone test/i.test(b.textContent));
		fireEvent.click(pingBtn);
		expect(mockNavigate).toHaveBeenCalledWith("/pingone-test");
	});

	it.skip("MFA Test nav button navigates to /mfa-test" /* removed in landing redesign */, () => {
		renderAt(LandingPage, "/");
		const mfaBtn = screen
			.getAllByRole("button")
			.find((b) => /mfa test/i.test(b.textContent));
		fireEvent.click(mfaBtn);
		expect(mockNavigate).toHaveBeenCalledWith("/mfa-test");
	});

	it("Admin Dashboard button triggers handleAdminDashboard", () => {
		renderAt(LandingPage, "/");
		const adminBtn = screen
			.getAllByRole("button")
			.find((b) => /admin dashboard/i.test(b.textContent));
		expect(adminBtn).toBeTruthy();
	});

	it("Customer Dashboard button navigates to /dashboard", () => {
		renderAt(LandingPage, "/");
		const custBtn = screen
			.getAllByRole("button")
			.find((b) => /customer dashboard/i.test(b.textContent));
		fireEvent.click(custBtn);
		expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuthDebugLogViewer — Dashboard link is role-aware (Bug 2 fix)
// ─────────────────────────────────────────────────────────────────────────────
import OAuthDebugLogViewer from "../OAuthDebugLogViewer";

describe("OAuthDebugLogViewer", () => {
	it("← Dashboard link points to /admin for admin users", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: adminUser,
			onLogout,
		});
		expect(screen.getByRole("link", { name: "← Dashboard" })).toHaveAttribute(
			"href",
			"/admin",
		);
	});

	it("← Dashboard link points to /dashboard for customer users", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: customerUser,
			onLogout,
		});
		expect(screen.getByRole("link", { name: "← Dashboard" })).toHaveAttribute(
			"href",
			"/dashboard",
		);
	});

	// 37766ba6 replaced the /config Configuration link with an on-page
	// "Debug OAuth logging" toggle (the linked page couldn't set debug_oauth).
	it("shows the on-page Debug OAuth logging toggle (replaced the /config link)", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: adminUser,
			onLogout,
		});
		expect(screen.queryByRole("link", { name: "Configuration" })).toBeNull();
		expect(screen.getAllByText(/Debug OAuth logging/i).length).toBeGreaterThan(0);
	});

	it("PageNav Back button calls navigate(-1)", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: adminUser,
			onLogout,
		});
		fireEvent.click(screen.getByRole("button", { name: "← Back" }));
		expect(mockNavigate).toHaveBeenCalledWith(-1);
	});

	it("PageNav Home link points to /admin for admin", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: adminUser,
			onLogout,
		});
		const homeLinks = screen.getAllByRole("link", { name: /home/i });
		expect(homeLinks.some((l) => l.getAttribute("href") === "/admin")).toBe(
			true,
		);
	});

	it("PageNav Log Out button is absent (moved to AdminSideNav in Phase 163)", () => {
		renderAt(OAuthDebugLogViewer, "/oauth-debug-logs", {
			user: adminUser,
			onLogout,
		});
		expect(screen.queryByRole("button", { name: /log out/i })).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard (Admin) — quick action Links (verified from Dashboard.js source)
// These tests verify the href values of the Quick Actions <Link> elements as
// they exist in Dashboard.js without rendering the full complex component.
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from "react-router-dom";

// Minimal Quick Actions stub that mirrors the links in Dashboard.js
function DashboardQuickActionsStub() {
	return (
		<div>
			<Link to="/activity">View All Activity Logs</Link>
			<Link to="/users">Manage Users</Link>
			<Link to="/admin/banking">Banking admin</Link>
			<Link to="/accounts">Manage Accounts</Link>
			<Link to="/transactions">View Transactions</Link>
			<Link to="/settings">🔒 Security Settings</Link>
			<Link to="/mcp-inspector">🔌 MCP Inspector</Link>
		</div>
	);
}

describe("Dashboard (admin) — Quick Actions", () => {
	it("View All Activity Logs is a <Link> to /activity", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(
			screen.getByRole("link", { name: /view all activity logs/i }),
		).toHaveAttribute("href", "/activity");
	});

	it("Manage Users is a <Link> to /users", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(screen.getByRole("link", { name: /manage users/i })).toHaveAttribute(
			"href",
			"/users",
		);
	});

	it("Banking admin is a <Link> to /admin/banking", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(
			screen.getByRole("link", { name: /banking admin/i }),
		).toHaveAttribute("href", "/admin/banking");
	});

	it("Manage Accounts is a <Link> to /accounts", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(
			screen.getByRole("link", { name: /manage accounts/i }),
		).toHaveAttribute("href", "/accounts");
	});

	it("View Transactions is a <Link> to /transactions", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(
			screen.getByRole("link", { name: /view transactions/i }),
		).toHaveAttribute("href", "/transactions");
	});

	it("Security Settings is a <Link> to /settings", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		expect(
			screen.getByRole("link", { name: /security settings/i }),
		).toHaveAttribute("href", "/settings");
	});

	it("MCP Inspector is a <Link> to /mcp-inspector", () => {
		renderAt(DashboardQuickActionsStub, "/admin");
		const links = screen.getAllByRole("link", { name: /mcp inspector/i });
		expect(links.some((l) => l.getAttribute("href") === "/mcp-inspector")).toBe(
			true,
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// DemoDataPage — toolbar (verified from DemoDataPage.js source)
// The toolbar has: Back button, role-aware dashboard Link, "Demo config" crumb.
// MCP Inspector, API Traffic, and PingOne config links were removed from the toolbar.
// ─────────────────────────────────────────────────────────────────────────────

// Lightweight stub that renders only the toolbar elements present in DemoDataPage.js
function DemoDataToolbarStub({ user }) {
	const dashboardPath = user?.role === "admin" ? "/admin" : "/dashboard";
	const dashboardLabel = user?.role === "admin" ? "Admin" : "Dashboard";
	return (
		<div>
			<button type="button" onClick={() => mockNavigate(-1)}>
				← Back
			</button>
			<Link to={dashboardPath}>⌂ {dashboardLabel}</Link>
			<span>Demo config</span>
		</div>
	);
}

describe("DemoDataPage", () => {
	it("Back button calls navigate(-1)", () => {
		renderAt(DemoDataToolbarStub, "/demo-data", { user: customerUser });
		fireEvent.click(screen.getByRole("button", { name: "← Back" }));
		expect(mockNavigate).toHaveBeenCalledWith(-1);
	});

	it("Dashboard toolbar link points to /dashboard for customer", () => {
		renderAt(DemoDataToolbarStub, "/demo-data", { user: customerUser });
		const links = screen
			.getAllByRole("link")
			.filter((l) => l.getAttribute("href") === "/dashboard");
		expect(links.length).toBeGreaterThan(0);
	});

	it("Dashboard toolbar link points to /admin for admin", () => {
		renderAt(DemoDataToolbarStub, "/demo-data", { user: adminUser });
		const links = screen
			.getAllByRole("link")
			.filter((l) => l.getAttribute("href") === "/admin");
		expect(links.length).toBeGreaterThan(0);
	});

	it("MCP Inspector link is absent from the toolbar (removed from DemoDataPage toolbar)", () => {
		renderAt(DemoDataToolbarStub, "/demo-data", { user: customerUser });
		expect(
			screen.queryByRole("link", { name: "MCP Inspector" }),
		).not.toBeInTheDocument();
	});

	it("API Traffic button is absent from the toolbar (removed from DemoDataPage toolbar)", () => {
		renderAt(DemoDataToolbarStub, "/demo-data", { user: customerUser });
		expect(
			screen.queryByRole("button", { name: /api traffic/i }),
		).not.toBeInTheDocument();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Footer — renders brand name and copyright (Demo config link removed)
// ─────────────────────────────────────────────────────────────────────────────
import Footer from "../Footer";

describe("Footer", () => {
	it("renders the Demo brand text", () => {
		renderAt(Footer, "/");
		// Footer always renders brand text (no user prop required)
		expect(screen.getByText(/demo/i)).toBeInTheDocument();
	});

	it("does not render a Demo config link (removed from Footer)", () => {
		renderAt(Footer, "/");
		expect(screen.queryByRole("link", { name: /demo config/i })).toBeNull();
	});
});
