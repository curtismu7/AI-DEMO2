import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTokenChainOptional } from "../context/TokenChainContext";
import apiClient from "../services/apiClient";
import { resolveApiBaseUrl } from "../utils/resolveApiBaseUrl";
import { pingOneConsoleUrl } from "../utils/pingOneConsoleUrl";
// Toasts intentionally disabled on this page — they obscured the inline diagnostic
// panels. Status is conveyed by the on-page result/diagnostic cards instead.
const notifyError = () => {};
const notifyInfo = () => {};
const notifySuccess = () => {};
import ApiCallDisplay from "./ApiCallDisplay";
import TokenCard from "./TokenCard";
import ScopeNarrowingVisualization from "./ScopeNarrowingVisualization";
import { TokenColorLegend } from "./TokenColorSystem";
import "./PingOneTestPage.css";
import PingOneApiPanel from "./PingOneApiPanel";
import ApiCallPreviewCard from "./ApiCallPreviewCard";

// Configuration details for each test - what users need to verify in PingOne
const TEST_CONFIG = {
	authzToken: {
		appName: "Demo AI App - User Login",
		appType: "WEB_APP",
		requiredScopes: [
			"openid",
			"profile",
			"email",
			"read",
			"write",
			"ai:agent:read",
		],
		audience: null,
		spel: null,
	},
	agentToken: {
		appName: "Demo AI App - Token Exchanger",
		appType: "AI_AGENT",
		requiredScopes: ["openid", "read", "write", "mcp:invoke"],
		audience: null,
		spel: null,
	},
	exchange1: {
		appName: "Demo AI App - Token Exchanger",
		appType: "AI_AGENT",
		requiredScopes: ["openid", "read", "write", "mcp:invoke"],
		audience: "mcpserver.ping.demo",
		spel: "T1 (user token) → MCP token",
		agentPrompt: "Show me my account balances",
	},
	exchange2: {
		appName: "Demo AI App - Token Exchanger",
		appType: "AI_AGENT",
		requiredScopes: ["openid", "read", "write", "mcp:invoke"],
		audience: "https://mcp-gateway.pingdemo.com",
		spel: "2-exchange (dual-token): Single POST — T1 (user) as subject + Agent CC as actor → Ping Agent Gateway token with act claim",
		agentPrompt: "Transfer $500 from checking to savings on behalf of the user",
	},
	apps: {
		appName: "Demo AI App - User Login",
		appType: "WEB_APP",
		requiredScopes: null,
		audience: null,
		spel: null,
	},
	resources: {
		appName: "Demo MCP Server",
		appType: "RESOURCE_SERVER",
		requiredScopes: null,
		audience: "mcpserver.ping.demo",
		spel: null,
	},
	scopes: {
		appName: "Demo MCP Server",
		appType: "RESOURCE_SERVER",
		requiredScopes: ["read", "write", "mcp:invoke"],
		audience: "mcpserver.ping.demo",
		spel: null,
	},
	users: {
		appName: "Demo AI App - User Login",
		appType: "WEB_APP",
		requiredScopes: null,
		audience: null,
		spel: null,
	},
};

const EXPECTED_APP_NAMES = [
	"Demo AI App - User Login",
	"Demo AI App - Admin Login",
	"Demo AI App - Token Exchanger",
	"Demo AI App - AI Agent Actor",
];
// Canonical Demo API scopes that actually exist on the resource server (verified
// against PingOne — no flat `admin`/`sensitive`/`ai:agent`; admin is split into
// admin:read/write/delete and the agent marker is ai:agent:read).
const EXPECTED_BANKING_SCOPES = [
	"read",
	"write",
	"transfer",
	"ai:agent:read",
	"admin:read",
	"admin:write",
];

// Metadata for each config/resource key: env var name, format hint, inline fix message
const CONFIG_META = {
	environmentId: {
		envVar: "PINGONE_ENVIRONMENT_ID",
		format: "UUID — e.g. 12345678-1234-1234-1234-123456789012",
		failMsg:
			"Not set — add PINGONE_ENVIRONMENT_ID=<your-env-uuid> to .env and restart the server",
	},
	region: {
		envVar: "PINGONE_REGION",
		format: "com | eu | ca | asia",
		failMsg: "Not set — add PINGONE_REGION=com to .env (default is com)",
	},
	adminClientId: {
		envVar: "PINGONE_ADMIN_CLIENT_ID",
		format:
			"UUID — copy Client ID from PingOne → Applications → Demo AI App - Admin Login",
		failMsg:
			"Not set — add PINGONE_ADMIN_CLIENT_ID=<uuid> to .env; get value from PingOne → Applications",
	},
	userClientId: {
		envVar: "PINGONE_USER_CLIENT_ID",
		format:
			"UUID — copy Client ID from PingOne → Applications → Demo AI App - User Login",
		failMsg:
			"Not set — add PINGONE_USER_CLIENT_ID=<uuid> to .env; get value from PingOne → Applications",
	},
	mcpTokenExchangerClientId: {
		envVar: "PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID",
		format:
			"UUID — copy from PingOne → Applications → Demo AI App - Token Exchanger",
		failMsg:
			"Not set — add PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID=<uuid> to .env",
	},
	aiAgentClientId: {
		envVar: "PINGONE_AI_AGENT_CLIENT_ID",
		format:
			"UUID — copy from PingOne → Applications → Demo AI App - AI Agent Actor",
		failMsg: "Not set — add PINGONE_AI_AGENT_CLIENT_ID=<uuid> to .env",
	},
	resourceMcpServerUri: {
		envVar: "PINGONE_RESOURCE_MCP_SERVER_URI",
		format: "URI — e.g. mcpserver.ping.demo",
		failMsg:
			"Not set — add PINGONE_RESOURCE_MCP_SERVER_URI=<uri> to .env (copy Audience URI from PingOne → Connections → Resource Servers → Demo MCP Server)",
	},
	resourceMcpGatewayUri: {
		envVar: "PINGONE_RESOURCE_MCP_GATEWAY_URI",
		format: "URI — e.g. https://mcp-gateway.pingdemo.com",
		failMsg:
			"Not set — add PINGONE_RESOURCE_MCP_GATEWAY_URI=<uri> to .env (copy Audience URI from PingOne → Connections → Resource Servers → Demo Agent Gateway)",
	},
	resourceAgentGatewayUri: {
		envVar: "PINGONE_RESOURCE_AGENT_GATEWAY_URI",
		format: "URI — e.g. agentgateway.ping.demo",
		failMsg:
			"Not set — add PINGONE_RESOURCE_AGENT_GATEWAY_URI=<uri> to .env (copy Audience URI from PingOne → Connections → Resource Servers → Demo Agent Gateway)",
	},
};

// Token-exchange flows shown one-at-a-time in the segmented selector.
const EXCHANGE_FLOWS = [
	{ id: "two", label: "2-Exchange: User Token + Agent CC" },
	{ id: "id", label: "2-Exchange: ID Token + Agent CC" },
	{ id: "simple", label: "Simple Exchange (Access Token only)" },
];

/**
 * CollapsibleSection — wraps a page section in an accordion with a clickable
 * header. Keeps the existing .pingone-test-section / -title styling so the
 * collapsed/expanded states match the rest of the page. Heavy diagnostic
 * sections start collapsed; the two primary test sections start open.
 */
function CollapsibleSection({ title, defaultOpen = false, children }) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section
			className={`pingone-test-section pingone-test-section--collapsible${open ? " is-open" : ""}`}
		>
			<button
				type="button"
				className="pingone-test-section-toggle"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className="pingone-test-section-caret" aria-hidden="true">
					{open ? "▾" : "▸"}
				</span>
				<h2 className="pingone-test-section-title">{title}</h2>
			</button>
			{open && (
				<div className="pingone-test-section-body">{children}</div>
			)}
		</section>
	);
}

/**
 * PingOneTestPage — comprehensive test page for PingOne integration
 * Tests: APIs, Token exchange, Configuration (Apps, Scopes, Resources, Users)
 * Chase.com-style UI with fix buttons for each test
 */
export default function PingOneTestPage() {
	const tokenChainCtx = useTokenChainOptional();
	// Ref holding the active EventSource so it can be closed and replaced per run.
	const esRef = useRef(null);
	const [workerToken, setWorkerToken] = useState(null);
	const [workerTokenExpiry, setWorkerTokenExpiry] = useState(null);
	const [workerTokenError, setWorkerTokenError] = useState(null);
	const [config, setConfig] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [testResults, setTestResults] = useState({});

	// Worker token configuration state
	const [workerConfig, setWorkerConfig] = useState({
		clientId: "",
		clientSecret: "",
		authMethod: "basic",
		tokenExchangeAuthMethod: "post",
	});
	const [savingConfig, setSavingConfig] = useState(false);
	const [configSaveError, setConfigSaveError] = useState(null);
	const [configSaveSuccess, setConfigSaveSuccess] = useState(false);

	// Asset verification state
	const [assetVerification, setAssetVerification] = useState(null);
	const [verifyingAssets, setVerifyingAssets] = useState(false);
	const [scopeFixing, setScopeFixing] = useState(false);
	const [scopeFixResult, setScopeFixResult] = useState(null);

	// MCP exchange diagnostics
	const [mcpExchangeDiag, setMcpExchangeDiag] = useState(null);
	const [mcpExchangeFixing, setMcpExchangeFixing] = useState(false);
	const [mcpExchangeFixResult, setMcpExchangeFixResult] = useState(null);

	// Login type from session ('admin' | 'customer' | 'ai_agent') — set when authz token loads
	const [loginType, setLoginType] = useState(null);

	// Token acquisition tests state
	const [authzTokenStatus, setAuthzTokenStatus] = useState("pending");
	const [agentTokenStatus, setAgentTokenStatus] = useState("pending");
	const [authzTokenError, setAuthzTokenError] = useState(null);
	const [agentTokenError, setAgentTokenError] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [agentPingoneReq, _setAgentPingoneReq] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [agentPingoneRes, _setAgentPingoneRes] = useState(null);

	// Token exchange tests state
	// Which exchange flow is shown: "two" (user token + agent CC), "id" (ID
	// token + agent CC), or "simple" (access token only). Only one renders at a
	// time so the section stays focused instead of three stacked columns.
	const [exchangeFlow, setExchangeFlow] = useState("two");
	const [exchange1Status, setExchange1Status] = useState("pending");
	const [exchange2Status, setExchange2Status] = useState("pending");
	const [exchange401Status, setExchange401Status] = useState("pending");
	const [exchange1Error, setExchange1Error] = useState(null);
	const [exchange2Error, setExchange2Error] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange2PingoneReq, _setExchange2PingoneReq] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange2PingoneRes, _setExchange2PingoneRes] = useState(null);
	const [exchange401Error, setExchange401Error] = useState(null);
	const [exchange401Decoded, setExchange401Decoded] = useState(null);
	const [exchange401Steps, setExchange401Steps] = useState([]);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange401PingoneReq, _setExchange401PingoneReq] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange401PingoneRes, _setExchange401PingoneRes] = useState(null);
	/* eslint-disable no-unused-vars */
	const [_exchangeIdTokenStatus, setExchangeIdTokenStatus] =
		useState("pending");
	const [_exchangeIdTokenError, setExchangeIdTokenError] = useState(null);
	const [_exchangeIdTokenDecoded, setExchangeIdTokenDecoded] = useState(null);
	const [_exchangeIdTokenSubjectDecoded, setExchangeIdTokenSubjectDecoded] =
		useState(null);
	/* eslint-enable no-unused-vars */
	const [exchange186Status, setExchange186Status] = useState("pending");
	const [exchange186Error, setExchange186Error] = useState(null);
	const [exchange186Decoded, setExchange186Decoded] = useState(null);
	const [exchange186SubjectDecoded, setExchange186SubjectDecoded] =
		useState(null);
	const [exchange186ActorDecoded, setExchange186ActorDecoded] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange186PingoneReq, _setExchange186PingoneReq] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [exchange186PingoneRes, _setExchange186PingoneRes] = useState(null);
	// eslint-disable-next-line no-unused-vars
	// eslint-disable-next-line no-unused-vars
	const [ffIdTokenExchange, _setFfIdTokenExchange] = useState(false);

	// Decoded token claims from BFF (server-side decode — no raw JWT in browser)
	const [authzDecoded, setAuthzDecoded] = useState(null);
	const [agentDecoded, setAgentDecoded] = useState(null);
	/* eslint-disable no-unused-vars */
	const [_exchange1Decoded, setExchange1Decoded] = useState(null);
	/* eslint-enable no-unused-vars */
	const [exchange2Decoded, setExchange2Decoded] = useState(null);
	/* eslint-disable no-unused-vars */
	const [_exchange1SubjectDecoded, setExchange1SubjectDecoded] = useState(null);
	const [_exchange1ActorDecoded, setExchange1ActorDecoded] = useState(null);
	/* eslint-enable no-unused-vars */
	const [exchange2SubjectDecoded, setExchange2SubjectDecoded] = useState(null);
	const [exchange2ActorDecoded, setExchange2ActorDecoded] = useState(null);
	const [exchange401AgentDecoded, setExchange401AgentDecoded] = useState(null);
	const [exchange401SubjectDecoded, setExchange401SubjectDecoded] =
		useState(null);
	const [workerDecoded, setWorkerDecoded] = useState(null);

	// Current time for updating time remaining display
	const [currentTime, setCurrentTime] = useState(new Date());

	// Update current time every second to refresh time remaining display
	useEffect(() => {
		const interval = setInterval(() => {
			setCurrentTime(new Date());
		}, 1000);

		return () => clearInterval(interval);
	}, []);

	// SSE — receive live token/exchange events as tests run.
	// openSseStream() is called at the start of each test run to close any prior
	// connection and open a fresh one, preventing stale streams on repeated runs.
	const openSseStream = useCallback(() => {
		if (esRef.current) { esRef.current.close(); esRef.current = null; }
		const base = resolveApiBaseUrl();
		const es = new EventSource(`${base}/api/pingone-test/events`, { withCredentials: true });
		esRef.current = es;

		es.onmessage = (e) => {
			let evt;
			try { evt = JSON.parse(e.data); } catch { return; }

			const toStatus = (s) => s === 'success' ? 'passed' : s === 'error' ? 'failed' : s;

			if (evt.type === 'token') {
				if (evt.id === 'authz-token') {
					setAuthzTokenStatus(toStatus(evt.status));
					if (evt.decoded) setAuthzDecoded(evt.decoded);
					if (evt.error) setAuthzTokenError(evt.error);
				} else if (evt.id === 'agent-token') {
					setAgentTokenStatus(toStatus(evt.status));
					if (evt.decoded) setAgentDecoded(evt.decoded);
					if (evt.error) setAgentTokenError(evt.error);
				} else if (evt.id === 'worker-token') {
					if (evt.decoded) setWorkerDecoded(evt.decoded);
					if (evt.expiresAt) setWorkerTokenExpiry({ expiresAt: evt.expiresAt });
					if (evt.error) setWorkerTokenError(evt.error);
				}
			} else if (evt.type === 'exchange') {
				if (evt.id === 'exchange-user-to-mcp') {
					setExchange1Status(toStatus(evt.status));
					if (evt.decoded) setExchange1Decoded(evt.decoded);
					if (evt.subjectDecoded) setExchange1SubjectDecoded(evt.subjectDecoded);
					if (evt.error) setExchange1Error(evt.error);
				} else if (evt.id === 'exchange-user-agent-to-mcp') {
					setExchange2Status(toStatus(evt.status));
					if (evt.decoded) setExchange2Decoded(evt.decoded);
					if (evt.subjectDecoded) setExchange2SubjectDecoded(evt.subjectDecoded);
					if (evt.actorDecoded) setExchange2ActorDecoded(evt.actorDecoded);
					if (evt.error) setExchange2Error(evt.error);
				}
			}
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps -- state setters are stable refs

	useEffect(() => {
		openSseStream();
		return () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } };
	}, [openSseStream]);

	// Load test results from localStorage on mount
	useEffect(() => {
		const savedResults = localStorage.getItem("pingoneTestResults");
		if (savedResults) {
			const results = JSON.parse(savedResults);
			setAuthzTokenStatus(results.authzTokenStatus || "pending");
			setAgentTokenStatus(results.agentTokenStatus || "pending");
			setAuthzTokenError(results.authzTokenError || null);
			setAgentTokenError(results.agentTokenError || null);
			setExchange1Status(results.exchange1Status || "pending");
			setExchange2Status(results.exchange2Status || "pending");
			setExchange401Status(results.exchange401Status || "pending");
			setExchange1Error(results.exchange1Error || null);
			setExchange2Error(results.exchange2Error || null);
			setExchange401Error(results.exchange401Error || null);
		}
	}, []);

	// Save test results to localStorage whenever they change
	useEffect(() => {
		const results = {
			authzTokenStatus,
			agentTokenStatus,
			authzTokenError,
			agentTokenError,
			exchange1Status,
			exchange2Status,
			exchange401Status,
			exchange1Error,
			exchange2Error,
			exchange401Error,
		};
		localStorage.setItem("pingoneTestResults", JSON.stringify(results));
	}, [
		authzTokenStatus,
		agentTokenStatus,
		authzTokenError,
		agentTokenError,
		exchange1Status,
		exchange2Status,
		exchange401Status,
		exchange1Error,
		exchange2Error,
		exchange401Error,
	]);

	// Load existing worker config consolidated into main startup effect below

	const isTokenValid = (expiresAt) => {
		if (!expiresAt) return false;
		try {
			const expiryDate = new Date(expiresAt);
			const now = new Date();
			return expiryDate > now;
		} catch {
			return false;
		}
	};

	const formatExpiryTime = (expiresAt) => {
		if (!expiresAt) return "Unknown";
		const expiryDate = new Date(expiresAt);
		return expiryDate.toLocaleString();
	};

	const formatTimeRemaining = (expiresAt) => {
		if (!expiresAt) return "Unknown";
		const expiryDate = new Date(expiresAt);
		const now = currentTime;
		const diffMs = expiryDate - now;

		if (diffMs <= 0) return "Expired";

		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const remainingMins = diffMins % 60;

		if (diffHours > 0) {
			return `${diffHours}h ${remainingMins}m`;
		} else {
			return `${remainingMins}m`;
		}
	};

	// Resets all token result state to a clean baseline.
	// Preserves workerConfig (credentials/config) and PingOne config.
	const handleClearAllTokenState = useCallback(() => {
		setWorkerToken(null);
		setWorkerTokenExpiry(null);
		setWorkerTokenError(null);
		setWorkerDecoded(null);
		setAuthzTokenStatus("pending");
		setAgentTokenStatus("pending");
		setAuthzTokenError(null);
		setAgentTokenError(null);
		setAuthzDecoded(null);
		setAgentDecoded(null);
		setExchange1Status("pending");
		setExchange2Status("pending");
		setExchange401Status("pending");
		setExchange1Error(null);
		setExchange2Error(null);
		setExchange401Error(null);
		setExchange401Decoded(null);
		setExchange401Steps([]);
		setExchange401AgentDecoded(null);
		setExchange2Decoded(null);
		setExchange2SubjectDecoded(null);
		setExchange2ActorDecoded(null);
		setExchange186Status("pending");
		setExchange186Error(null);
		setExchange186Decoded(null);
		setExchange186ActorDecoded(null);
		setExchangeIdTokenError(null);
		setExchangeIdTokenDecoded(null);
		setMcpExchangeDiag(null);
		setMcpExchangeFixResult(null);
		setScopeFixResult(null);
		setTestResults({});
	}, [
		setWorkerToken, setWorkerTokenExpiry, setWorkerTokenError, setWorkerDecoded,
		setAuthzTokenStatus, setAgentTokenStatus, setAuthzTokenError, setAgentTokenError,
		setAuthzDecoded, setAgentDecoded,
		setExchange1Status, setExchange2Status, setExchange401Status,
		setExchange1Error, setExchange2Error, setExchange401Error,
		setExchange401Decoded, setExchange401Steps, setExchange401AgentDecoded,
		setExchange2Decoded, setExchange2SubjectDecoded, setExchange2ActorDecoded,
		setExchange186Status, setExchange186Error, setExchange186Decoded, setExchange186ActorDecoded,
		setExchangeIdTokenError, setExchangeIdTokenDecoded,
		setMcpExchangeDiag, setMcpExchangeFixResult, setScopeFixResult, setTestResults,
	]);

	const loadWorkerToken = useCallback(async () => {
		try {
			notifyInfo("Fetching worker token...", {
				toastId: "worker-token-loading",
			});
			const { data } = await apiClient.get("/api/pingone-test/worker-token");
			console.log("[loadWorkerToken] API response:", data);
			if (data.success) {
				setWorkerToken(data.status || null);
				setWorkerDecoded(data.decoded || null);
				setWorkerTokenExpiry({
					expiresAt: data.expiresAt,
					expiresIn: data.expiresIn,
				});
				setWorkerTokenError(null);
				notifySuccess("Worker token fetched successfully");
			} else {
				const errorMsg = data.error || "Failed to fetch worker token";
				setWorkerTokenError(errorMsg);
				notifyError(errorMsg);
			}
		} catch (error) {
			console.error("[loadWorkerToken] Error:", error);
			const errorMsg = error.message || "Failed to fetch worker token";
			setWorkerTokenError(errorMsg);
			notifyError(errorMsg);
		}
	}, []);

	const loadConfig = useCallback(async () => {
		try {
			const { data } = await apiClient.get("/api/pingone-test/config");
			if (data.success) {
				setConfig(data.config);
				setLoading(false);
			} else {
				setError(`Failed to load config: ${data.error}`);
				setLoading(false);
			}
		} catch (err) {
			console.error("Config error:", err);
			setError(`Failed to load config: ${err.message}`);
			setLoading(false);
		}
	}, []);

	// Load worker token and config on startup; also auto-check authz token so
	// the "Login required" state shows immediately without a manual Test click.
	useEffect(() => {
		loadWorkerToken();
		loadConfig();
		// Silently probe the authz token — if no session the card will show Login button
		apiClient
			.get("/api/pingone-test/authz-token")
			.then(({ data }) => {
				if (data.success) {
					setAuthzTokenStatus("passed");
					setAuthzDecoded(data.decoded || null);
					setAuthzTokenError(null);
					setLoginType(data.loginType || null);
				} else {
					setAuthzTokenStatus("failed");
					setAuthzTokenError(data.error);
				}
			})
			.catch(() => {
				/* network error — leave as pending */
			});
	}, [loadWorkerToken, loadConfig]);

	// Poll worker token status - every 5 minutes, or every 1 minute if under 5 minutes remaining
	useEffect(() => {
		if (!workerTokenExpiry) return;

		const getPollInterval = () => {
			if (!workerTokenExpiry.expiresAt) return 5 * 60 * 1000; // 5 minutes default
			const expiryDate = new Date(workerTokenExpiry.expiresAt);
			const now = new Date();
			const diffMs = expiryDate - now;
			const diffMins = Math.floor(diffMs / 60000);

			// If under 5 minutes remaining, poll every 1 minute
			if (diffMins < 5 && diffMins > 0) {
				return 1 * 60 * 1000; // 1 minute
			}
			return 5 * 60 * 1000; // 5 minutes
		};

		const interval = setInterval(() => {
			loadWorkerToken();
		}, getPollInterval());

		return () => clearInterval(interval);
	}, [workerTokenExpiry, loadWorkerToken]);

	const runTest = useCallback(async (testName, testFn) => {
		setTestResults((prev) => ({
			...prev,
			[testName]: { status: "running", result: null, error: null },
		}));
		notifyInfo(`Running ${testName}…`, { toastId: `test-${testName}` });

		try {
			const result = await testFn();
			setTestResults((prev) => ({
				...prev,
				[testName]: { status: "passed", result, error: null },
			}));
			notifySuccess(`${testName} passed ✓`);
		} catch (err) {
			setTestResults((prev) => ({
				...prev,
				[testName]: { status: "failed", result: null, error: err.message },
			}));
			notifyError(`${testName} failed: ${err.message}`);
		}
	}, []);

	const fixIssue = useCallback(
		(testName) => {
			const envId = config?.environmentId;
			// PingOne rejects /edit/{envId}/# with "Invalid Sign-on URL"; use ?env=.
			const appsUrl = pingOneConsoleUrl(envId, "/application/list");
			const resourcesUrl = pingOneConsoleUrl(envId, "/foundation/Resource/list");
			const usersUrl = pingOneConsoleUrl(envId, "/users/list");
			const consoleHome = pingOneConsoleUrl(envId);

			const fixActions = {
				environmentId: {
					msg: "Set PINGONE_ENVIRONMENT_ID in your .env file, then restart the server.",
					url: consoleHome,
				},
				region: {
					msg: "Set PINGONE_REGION in .env (e.g. com | eu | ca). Default is com.",
					url: null,
				},
				adminClientId: {
					msg: "Set PINGONE_ADMIN_CLIENT_ID — copy Client ID from PingOne → Applications → Demo AI App - Admin Login.",
					url: appsUrl,
				},
				userClientId: {
					msg: "Set PINGONE_USER_CLIENT_ID — copy Client ID from PingOne → Applications → Demo AI App - User Login.",
					url: appsUrl,
				},
				mcpTokenExchangerClientId: {
					msg: "Set PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID — copy from PingOne → Applications → Demo AI App - Token Exchanger.",
					url: appsUrl,
				},
				aiAgentClientId: {
					msg: "Set PINGONE_AI_AGENT_CLIENT_ID — copy from PingOne → Applications → Demo AI App - AI Agent Actor.",
					url: appsUrl,
				},
				resourceMcpServerUri: {
					msg: "Set PINGONE_RESOURCE_MCP_SERVER_URI — copy the Audience URI from PingOne → Connections → Resource Servers → Demo MCP Server.",
					url: resourcesUrl,
				},
				resourceMcpGatewayUri: {
					msg: "Set PINGONE_RESOURCE_MCP_GATEWAY_URI — Audience URI for the Agent Gateway resource server.",
					url: resourcesUrl,
				},
				resourceAgentGatewayUri: {
					msg: "Set PINGONE_RESOURCE_AGENT_GATEWAY_URI — Audience URI for the Agent Gateway resource server.",
					url: resourcesUrl,
				},
				"single-exchange": {
					msg: 'PingOne error: "At least one scope must be granted" means the MCP Token Exchanger app is missing banking scopes. Fix: PingOne → Applications → Demo AI App - Token Exchanger → Resources tab → add read, write, mcp:invoke from the Demo Agent Gateway resource server. Also enable Token Exchange grant type.',
					url: appsUrl,
				}, // legacy dispatch key — not user-facing; canonical: 1-exchange
				"double-exchange": {
					msg: "2-exchange (dual-token) needs Ping Agent Gateway alignment: MCP Token Exchanger app must have banking scopes, user token must carry may_act, and actor_token policy must allow gateway exchange. Fix: Applications → MCP Token Exchanger → Resources tab.",
					url: appsUrl,
				}, // legacy dispatch key — not user-facing; canonical: 2-exchange
				apps: {
					msg: "In PingOne → Worker App → Roles → assign Read Clients / Applications role.",
					url: appsUrl,
				},
				resources: {
					msg: "In PingOne → Worker App → Roles → assign Read Resource Servers role.",
					url: resourcesUrl,
				},
				scopes: {
					msg: "In PingOne → Worker App → Roles → assign Read Scopes role.",
					url: resourcesUrl,
				},
				users: {
					msg: "In PingOne → Worker App → Roles → assign Read Users role.",
					url: usersUrl,
				},
			};

			const action = fixActions[testName];
			if (!action) {
				notifyInfo(
					"Check configuration for this item in PingOne admin console.",
				);
				if (consoleHome) {
					window.open(consoleHome, "_blank", "noopener,noreferrer");
				}
				return;
			}
			notifyInfo(action.msg, { autoClose: 10000 });
			if (action.url) window.open(action.url, "_blank", "noopener,noreferrer");
		},
		[config],
	);

	const saveWorkerConfig = useCallback(async () => {
		setSavingConfig(true);
		setConfigSaveError(null);
		setConfigSaveSuccess(false);

		try {
			notifyInfo("Saving worker configuration...", {
				toastId: "worker-config-saving",
			});
			const { data } = await apiClient.post("/api/pingone-test/worker-config", {
				clientId: workerConfig.clientId,
				clientSecret: workerConfig.clientSecret,
				authMethod: workerConfig.authMethod,
				tokenExchangeAuthMethod: workerConfig.tokenExchangeAuthMethod,
			});

			if (data.success) {
				setConfigSaveSuccess(true);
				notifySuccess("Worker configuration saved successfully");
				// Display details about the storage method
				if (data.details) {
					console.log("[PingOneTest] Storage details:", data.details);
				}
				// Reload config after saving
				const { data: configData } = await apiClient.get(
					"/api/pingone-test/config",
				);
				if (configData.success) {
					setConfig(configData);
				}
				setTimeout(() => setConfigSaveSuccess(false), 5000); // Show success for 5 seconds to allow reading details
			} else {
				const errorMsg = data.error || "Failed to save configuration";
				setConfigSaveError(errorMsg);
				notifyError(errorMsg);
			}
		} catch (err) {
			const errorMsg = err.message || "Failed to save configuration";
			setConfigSaveError(errorMsg);
			notifyError(errorMsg);
		} finally {
			setSavingConfig(false);
		}
	}, [workerConfig]);

	const verifyAssets = useCallback(async () => {
		setVerifyingAssets(true);
		setAssetVerification(null);

		try {
			notifyInfo("Verifying PingOne assets...", {
				toastId: "verify-assets-loading",
			});
			const { data } = await apiClient.get("/api/pingone-test/verify-assets");
			if (data.success) {
				setAssetVerification(data.assets);
				notifySuccess("Asset verification completed");
			} else {
				const errorMsg = data.error || "Asset verification failed";
				setAssetVerification({ error: errorMsg });
				notifyError(errorMsg);
			}
		} catch (err) {
			const errorMsg = err.message || "Asset verification failed";
			setAssetVerification({ error: errorMsg });
			notifyError(errorMsg);
		} finally {
			setVerifyingAssets(false);
		}
	}, []);

	const fixBankingResourceServer = useCallback(async () => {
		setScopeFixing(true);
		setScopeFixResult(null);
		try {
			const { data } = await apiClient.post(
				"/api/pingone-test/fix-banking-resource-server",
				{},
				{
					params: { sessionId: "pingone-test" },
				},
			);
			setScopeFixResult(data);
			if (data.success) {
				notifySuccess("Banking resource server updated — re-verifying…");
				await verifyAssets();
			} else {
				notifyError(`Fix failed: ${data.error}`);
			}
		} catch (err) {
			setScopeFixResult({ success: false, error: err.message });
			notifyError(`Fix failed: ${err.message}`);
		} finally {
			setScopeFixing(false);
		}
	}, [verifyAssets]);

	const diagnoseMcpExchange = useCallback(async () => {
		setMcpExchangeDiag(null);
		try {
			const { data } = await apiClient.get(
				"/api/pingone-test/diagnose-mcp-exchange",
			);
			setMcpExchangeDiag(data);
			if (data.canExchange && data.claimValidation?.allClaimsValid) {
				notifySuccess("MCP exchange configured correctly — claims validated ✓");
			} else if (data.canExchange && !data.claimValidation?.tested) {
				notifySuccess("MCP exchange config OK (log in to validate claims)");
			} else if (data.canExchange) {
				notifyError(
					"MCP exchange config OK but token claims have issues — see details",
				);
			} else {
				notifyError("MCP exchange has config issues — see diagnostic panel");
			}
		} catch (err) {
			setMcpExchangeDiag({ success: false, error: err.message });
			notifyError(`Diagnose failed: ${err.message}`);
		}
	}, []);

	const fixMcpExchange = useCallback(async () => {
		setMcpExchangeFixing(true);
		setMcpExchangeFixResult(null);
		try {
			const { data } = await apiClient.post(
				"/api/pingone-test/fix-mcp-exchange",
				{},
			);
			setMcpExchangeFixResult(data);
			if (data.success) {
				notifySuccess("MCP exchange config fixed — re-diagnosing…");
				const { data: diag } = await apiClient.get(
					"/api/pingone-test/diagnose-mcp-exchange",
				);
				setMcpExchangeDiag(diag);
			} else {
				notifyError(`Fix failed: ${data.error}`);
				setMcpExchangeDiag(data);
			}
		} catch (err) {
			notifyError(`Fix failed: ${err.message}`);
			setMcpExchangeFixResult({ success: false, error: err.message });
		} finally {
			setMcpExchangeFixing(false);
		}
	}, []);

	const testAuthzToken = useCallback(async () => {
		openSseStream(); // reopen SSE so this run gets a fresh event stream
		setAuthzTokenStatus("running");
		setAuthzTokenError(null);
		notifyInfo("Testing authorization token…", { toastId: "test-authz-token" });
		try {
			const { data } = await apiClient.get("/api/pingone-test/authz-token");
			if (data.success) {
				setAuthzTokenStatus("passed");
				setAuthzDecoded(data.decoded || null);
				setLoginType(data.loginType || null);
				notifySuccess("Authorization token found in session ✓");
			} else {
				setAuthzTokenStatus("failed");
				setAuthzTokenError(data.error);
				notifyError(`Auth token: ${data.error}`);
			}
		} catch (err) {
			setAuthzTokenStatus("failed");
			setAuthzTokenError(err.message);
			notifyError(`Auth token error: ${err.message}`);
		}
	}, [openSseStream]);

	const testAgentToken = useCallback(async () => {
		openSseStream(); // reopen SSE so this run gets a fresh event stream
		setAgentTokenStatus("running");
		setAgentTokenError(null);
		notifyInfo("Testing agent token (client credentials)…", {
			toastId: "test-agent-token",
		});
		try {
			const { data } = await apiClient.get("/api/pingone-test/agent-token");
			if (data.success) {
				setAgentTokenStatus("passed");
				setAgentDecoded(data.decoded || null);
				notifySuccess("Agent client-credentials token acquired ✓");
			} else {
				setAgentTokenStatus("failed");
				setAgentTokenError(data.error);
				notifyError(`Agent token: ${data.error}`);
			}
		} catch (err) {
			setAgentTokenStatus("failed");
			setAgentTokenError(err.message);
			notifyError(`Agent token error: ${err.message}`);
		}
	}, [openSseStream]);

	// eslint-disable-next-line no-unused-vars
	const _testExchange1 = useCallback(async () => {
		setExchange1Status("running");
		setExchange1Error(null);
		notifyInfo("Testing User Token → MCP Token exchange…", {
			toastId: "test-exchange1",
		});
		try {
			const { data } = await apiClient.get(
				"/api/pingone-test/exchange-user-to-mcp",
			);
			if (data.success) {
				setExchange1Status("passed");
				setExchange1Decoded(data.decoded || null);
				setExchange1SubjectDecoded(data.subjectTokenDecoded || null);
				setExchange1ActorDecoded(data.actorTokenDecoded || null);
				if (data.tokenEvents && tokenChainCtx?.setTokenEvents) {
					tokenChainCtx.setTokenEvents(
						"exchange-user-to-mcp",
						data.tokenEvents,
					);
				}
				notifySuccess("User → MCP token exchange succeeded ✓");
			} else {
				setExchange1Status("failed");
				setExchange1Error(data.error);
				notifyError(`1-exchange failed: ${data.error}`);
			}
		} catch (err) {
			setExchange1Status("failed");
			setExchange1Error(err.message);
			notifyError(`1-exchange error: ${err.message}`);
		}
	}, [tokenChainCtx]);

	const testExchange2 = useCallback(async () => {
		openSseStream(); // reopen SSE so this run gets a fresh event stream
		setExchange2Status("running");
		setExchange2Error(null);
		notifyInfo(
			"Testing 2-exchange (dual-token): User + Agent CC → Ping Agent Gateway…",
			{ toastId: "test-exchange2" },
		);
		try {
			const { data } = await apiClient.get(
				"/api/pingone-test/exchange-user-agent-to-mcp",
			);
			if (data.success) {
				setExchange2Status("passed");
				setExchange2Decoded(data.decoded || null);
				setExchange2SubjectDecoded(data.subjectTokenDecoded || null);
				setExchange2ActorDecoded(data.actorTokenDecoded || null);
				if (data.tokenEvents && tokenChainCtx?.setTokenEvents) {
					tokenChainCtx.setTokenEvents(
						"exchange-user-agent-to-mcp",
						data.tokenEvents,
					);
				}
				notifySuccess("2-exchange (dual-token) succeeded ✓");
			} else {
				setExchange2Status("failed");
				setExchange2Error(data.error);
				notifyError(`2-exchange failed: ${data.error}`);
			}
		} catch (err) {
			setExchange2Status("failed");
			setExchange2Error(err.message);
			notifyError(`2-exchange error: ${err.message}`);
		}
	}, [tokenChainCtx, openSseStream]);

	const testExchange401 = useCallback(async () => {
		openSseStream(); // reopen SSE so this run gets a fresh event stream
		setExchange401Status("running");
		setExchange401Error(null);
		setExchange401Steps([]);
		notifyInfo("Testing 1-Token Exchange via MCP 401 flow…", {
			toastId: "test-exchange-401",
		});
		try {
			const { data } = await apiClient.get(
				"/api/pingone-test/exchange-1token-401-flow",
				{
					params: { sessionId: "pingone-test" },
				},
			);
			setExchange401Status(data.success ? "passed" : "failed");
			setExchange401Error(data.success ? null : data.error);
			if (data.decoded) setExchange401Decoded(data.decoded);
			if (data.steps) setExchange401Steps(data.steps);
			if (data.agentTokenDecoded)
				setExchange401AgentDecoded(data.agentTokenDecoded);
			if (data.subjectTokenDecoded)
				setExchange401SubjectDecoded(data.subjectTokenDecoded);
			if (data.tokenEvents && tokenChainCtx?.setTokenEvents) {
				tokenChainCtx.setTokenEvents(
					"exchange-1token-401-flow",
					data.tokenEvents,
				);
			}
			if (data.success) notifySuccess("1-Token 401 Exchange succeeded ✓");
			else notifyError(`Exchange 401 failed: ${data.error}`);
		} catch (err) {
			setExchange401Status("failed");
			setExchange401Error(err.message);
			notifyError(`Exchange 401 error: ${err.message}`);
		}
	}, [tokenChainCtx, openSseStream]);

	// eslint-disable-next-line no-unused-vars
	const _testExchangeIdToken = useCallback(async () => {
		setExchangeIdTokenStatus("running");
		setExchangeIdTokenError(null);
		try {
			notifyInfo("Testing ID Token → MCP Token exchange…", {
				toastId: "test-exchange-id",
			});
			const { data } = await apiClient.get(
				"/api/pingone-test/exchange-id-token-to-mcp",
				{
					params: { sessionId: "pingone-test" },
				},
			);
			setExchangeIdTokenStatus(data.success ? "passed" : "failed");
			setExchangeIdTokenError(data.success ? null : data.error);
			if (data.decoded) setExchangeIdTokenDecoded(data.decoded);
			if (data.subjectDecoded)
				setExchangeIdTokenSubjectDecoded(data.subjectDecoded);
			if (data.success)
				notifySuccess("ID Token → MCP token exchange succeeded ✓");
		} catch (err) {
			setExchangeIdTokenStatus("failed");
			setExchangeIdTokenError(err.message);
		}
	}, []);

	const testExchange186 = useCallback(async () => {
		setExchange186Status("running");
		setExchange186Error(null);
		try {
			notifyInfo(
				"Testing ID Token + Agent CC \u2192 Ping Agent Gateway Token (Phase 186)\u2026",
				{ toastId: "test-exchange-186" },
			);
			const { data } = await apiClient.get(
				"/api/pingone-test/exchange-idtoken-agent-to-mcp",
				{
					params: { sessionId: "pingone-test" },
				},
			);
			setExchange186Status(data.success ? "passed" : "failed");
			setExchange186Error(data.success ? null : data.error);
			if (data.decoded) setExchange186Decoded(data.decoded);
			if (data.subjectTokenDecoded)
				setExchange186SubjectDecoded(data.subjectTokenDecoded);
			if (data.actorTokenDecoded)
				setExchange186ActorDecoded(data.actorTokenDecoded);
			if (data.tokenEvents && tokenChainCtx) {
				data.tokenEvents.forEach((evt) => {
					tokenChainCtx.addEvent(evt);
				});
			}
			if (data.success)
				notifySuccess(
					"Phase 186: ID Token + Agent CC \u2192 Ping Agent Gateway token succeeded \u2713",
				);
		} catch (err) {
			setExchange186Status("failed");
			setExchange186Error(err.message);
		}
	}, [tokenChainCtx]);

	const testApps = useCallback(async () => {
		const { data } = await apiClient.get("/api/pingone-test/apps");
		if (!data.success) throw new Error(data.error);
		return { count: data.count, apps: data.apps };
	}, []);

	const testAiAgentApps = useCallback(async () => {
		const { data } = await apiClient.get("/api/pingone-test/ai-agent-apps");
		if (!data.success) throw new Error(data.error);
		return {
			count: data.count,
			apps: data.apps,
			missingExpected: data.missingExpected,
			totalApps: data.totalApps,
		};
	}, []);

	const updateResources = useCallback(async () => {
		const { data } = await apiClient.post("/api/pingone-test/update-resources");
		if (!data.success) throw new Error(data.error);
		return { steps: data.steps };
	}, []);

	const updateScopes = useCallback(async () => {
		const { data } = await apiClient.post("/api/pingone-test/update-scopes");
		if (!data.success) throw new Error(data.error);
		return { results: data.results };
	}, []);

	const updateApps = useCallback(async () => {
		const { data } = await apiClient.post("/api/pingone-test/update-apps");
		if (!data.success) throw new Error(data.error);
		return { steps: data.steps, aiAgentApps: data.aiAgentApps };
	}, []);

	const updateUserSpel = useCallback(async () => {
		const { data } = await apiClient.post(
			"/api/pingone-test/update-user-spel",
			{ enabled: true },
		);
		if (!data.success) throw new Error(data.error);
		return { message: data.message, userId: data.userId, mayAct: data.mayAct };
	}, []);

	const testResources = useCallback(async () => {
		const { data } = await apiClient.get("/api/pingone-test/resources");
		if (!data.success) throw new Error(data.error);
		return { count: data.count, resources: data.resources };
	}, []);

	const testScopes = useCallback(async () => {
		// Get resources first to find a resource server ID
		const { data: resourcesData } = await apiClient.get(
			"/api/pingone-test/resources",
		);
		if (!resourcesData.success || !resourcesData.resources?.length) {
			throw new Error("No resource servers found");
		}
		const resourceServerId = resourcesData.resources[0].id;

		const { data } = await apiClient.get(
			`/api/pingone-test/scopes?resourceServerId=${resourceServerId}`,
		);
		if (!data.success) throw new Error(data.error);
		return { count: data.count, scopes: data.scopes, resourceServerId };
	}, []);

	const testUsers = useCallback(async () => {
		const { data } = await apiClient.get("/api/pingone-test/users");
		if (!data.success) throw new Error(data.error);
		return { count: data.count, users: data.users };
	}, []);

	if (loading) {
		return (
			<div className="pingone-test-page">
				<div className="pingone-test-loading">
					<div className="spinner" />
					<p>Loading PingOne test environment...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="pingone-test-page">
				<div className="pingone-test-error">
					<p className="error-message">{error}</p>
					<button
						type="button"
						className="pingone-test-button pingone-test-button--primary"
						onClick={() => window.location.reload()}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="pingone-test-page">
			<div className="pingone-test-header">
				<h1 className="pingone-test-title">PingOne Integration Test Page</h1>
				<div className="pingone-test-identity">
					<span className="pingone-test-identity__label">Logged in as:</span>
					{loginType ? (
						<span className="pingone-test-identity__who">
							{loginType === "admin"
								? "Admin"
								: loginType === "ai_agent"
									? "AI Agent"
									: "Customer"}
						</span>
					) : (
						<span className="pingone-test-identity__who pingone-test-identity__who--none">
							Not logged in
						</span>
					)}
					<a
						href={`/api/auth/oauth/user/login?return_to=/pingone-test${loginType ? "&force=true" : ""}`}
						className="pingone-test-button pingone-test-button--secondary pingone-test-identity__switch"
					>
						{loginType ? "Switch user" : "Login to PingOne"}
					</a>
				</div>
				<div className="pingone-test-meta">
					<div className="pingone-test-status">
						<span
							className={`status-indicator ${workerToken === "valid" ? "status-indicator--success" : "status-indicator--error"}`}
						>
							{workerToken === "valid"
								? "Worker Token: Active"
								: "Worker Token: Missing"}
						</span>
					</div>
					<button
						type="button"
						className="pingone-test-button pingone-test-button--secondary"
						onClick={loadWorkerToken}
					>
						Refresh Worker Token
					</button>
				</div>
			</div>

			<div className="pingone-test-content">
				{/* Worker Token Configuration Section */}
				<CollapsibleSection title="Worker Token Configuration">
					<div className="worker-token-config">
						<div className="worker-token-config-form">
							<div className="worker-token-info">
								<h3>PingOne Token Endpoint</h3>
								<code className="code-block">
									{`POST https://auth.pingone.${config?.region || "com"}/${config?.environmentId}/as/token`}
								</code>
								<div className="token-params">
									<strong>
										Authentication Method: {workerConfig.authMethod || "basic"}
									</strong>
									{workerConfig.authMethod === "post" ? (
										<div className="request-details">
											<strong>Request Body:</strong>
											<pre className="code-block">
												{`{
  "grant_type": "client_credentials",
  "client_id": "${workerConfig.clientId || "..."}",
  "client_secret": "***"
}`}
											</pre>
										</div>
									) : (
										<div className="request-details">
											<strong>Request Headers:</strong>
											<pre className="code-block">
												{`Content-Type: application/x-www-form-urlencoded
Authorization: Basic ${workerConfig.clientId && workerConfig.clientSecret ? "*** (base64(client_id:client_secret))" : "..."}`}
											</pre>
											<strong>Request Body:</strong>
											<pre className="code-block">
												{`grant_type=client_credentials`}
											</pre>
										</div>
									)}
								</div>
							</div>
							{workerTokenExpiry && (
								<div className="worker-token-status">
									<span
										className={`status-indicator ${isTokenValid(workerTokenExpiry.expiresAt) ? "status-indicator--success" : "status-indicator--error"}`}
									>
										{isTokenValid(workerTokenExpiry.expiresAt)
											? "✓ Token Valid"
											: "✗ Token Expired"}
									</span>
									<span className="token-expiry">
										Expires: {formatExpiryTime(workerTokenExpiry.expiresAt)}
									</span>
									<span className="token-time-remaining">
										{formatTimeRemaining(workerTokenExpiry.expiresAt)}
									</span>
								</div>
							)}
							{workerTokenError && (
								<div className="worker-token-error">
									<span className="status-indicator status-indicator--error">
										✗ Error
									</span>
									<span className="error-message">{workerTokenError}</span>
								</div>
							)}
							{workerDecoded && (
								<TokenCard
									decoded={workerDecoded}
									title="Worker Token (Management API)"
									defaultExpanded
								/>
							)}
							<div className="token-actions">
								<button
									type="button"
									className="pingone-test-button pingone-test-button--secondary"
									onClick={loadWorkerToken}
									disabled={loading}
								>
									{loading ? "Loading..." : "Fetch Worker Token"}
								</button>
								<button
									type="button"
									className="pingone-test-button pingone-test-button--fix"
									onClick={handleClearAllTokenState}
								>
									Reset All Token State
								</button>
							</div>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									saveWorkerConfig();
								}}
							>
								<div className="form-group">
									<label htmlFor="worker-client-id">Client ID</label>
									<input
										id="worker-client-id"
										type="text"
										className="form-input"
										value={workerConfig.clientId}
										onChange={(e) =>
											setWorkerConfig((prev) => ({
												...prev,
												clientId: e.target.value,
											}))
										}
										placeholder="Enter PingOne Worker App Client ID"
									/>
								</div>
								<div className="form-group">
									<label htmlFor="worker-client-secret">Client Secret</label>
									<input
										id="worker-client-secret"
										type="password"
										className="form-input"
										value={workerConfig.clientSecret}
										onChange={(e) =>
											setWorkerConfig((prev) => ({
												...prev,
												clientSecret: e.target.value,
											}))
										}
										placeholder="Enter PingOne Worker App Client Secret"
									/>
								</div>
								<div className="form-group">
									<label htmlFor="worker-auth-method">
										Worker Token Auth Method (CC Grant)
									</label>
									<select
										id="worker-auth-method"
										className="form-select"
										value={workerConfig.authMethod}
										onChange={(e) =>
											setWorkerConfig((prev) => ({
												...prev,
												authMethod: e.target.value,
											}))
										}
									>
										<option value="basic">Basic (Authorization header)</option>
										<option value="post">Post (body parameters)</option>
										<option value="none">None (no authentication)</option>
									</select>
								</div>
								<div className="form-group">
									<label htmlFor="exchange-auth-method">
										Token Exchange Auth Method
									</label>
									<select
										id="exchange-auth-method"
										className="form-select"
										value={workerConfig.tokenExchangeAuthMethod}
										onChange={(e) =>
											setWorkerConfig((prev) => ({
												...prev,
												tokenExchangeAuthMethod: e.target.value,
											}))
										}
									>
										<option value="post">
											Post (body parameters) — PingOne AI_AGENT default
										</option>
										<option value="basic">Basic (Authorization header)</option>
										<option value="none">None (no authentication)</option>
									</select>
									<p className="form-hint">
										Used for RFC 8693 token exchange calls (1-exchange /
										2-exchange / Phase 186 ID-token exchange). PingOne AI_AGENT
										apps typically require <code>post</code>.
									</p>
								</div>
								<div className="form-actions">
									<button
										type="submit"
										className="pingone-test-button pingone-test-button--primary"
										disabled={savingConfig}
									>
										{savingConfig ? "Saving..." : "Save Configuration"}
									</button>
									{configSaveSuccess && (
										<span className="config-success">
											✓ Configuration saved successfully
										</span>
									)}
									{configSaveError && (
										<span className="config-error">✗ {configSaveError}</span>
									)}
								</div>
							</form>
						</div>
						<div className="worker-token-config-info">
							<p className="info-text">
								Configure the PingOne Worker App credentials for Management API
								access. These credentials will be saved to .env and Vercel
								environment variables.
							</p>
							<p className="info-text">
								<strong>Note:</strong> The Worker App must have the Management
								API roles (Applications, Users, etc.) configured in PingOne.
							</p>
						</div>
					</div>
					<ApiCallPreviewCard
						method="POST"
						endpoint="POST https://auth.pingone.{region}/{envId}/as/token"
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
						docsSectionTitle="Worker Token — client_credentials grant"
						requestBody={null}
						responseBody={null}
						label="Worker Token (PingOne Management API access)"
					/>
					<SectionApiCalls />
				</CollapsibleSection>

				{/* PingOne Asset Verification Section */}
				<CollapsibleSection title="Verify Resources & Scopes">
					<div className="asset-verification-header">
						<p className="asset-verification-description">
							Verify that the PingOne applications, resource servers, and scopes
							used by this Banking Demo are configured correctly.
						</p>
						<div className="asset-verification-actions">
							<button
								type="button"
								className="pingone-test-button pingone-test-button--primary"
								onClick={loadWorkerToken}
								disabled={verifyingAssets}
							>
								Get Worker Token
							</button>
							<button
								type="button"
								className="pingone-test-button pingone-test-button--secondary"
								onClick={verifyAssets}
								disabled={verifyingAssets}
							>
								{verifyingAssets ? "Verifying..." : "Verify Resources & Scopes"}
							</button>
						</div>
					</div>
					{assetVerification && (
						<div className="asset-verification-results">
							{assetVerification.error ? (
								<div className="asset-error">
									<p className="error-message">
										Error: {assetVerification.error}
									</p>
								</div>
							) : (
								<>
									<div className="asset-results-grid">
										<AssetCard
											title="Applications"
											status={assetVerification.applications?.status}
											count={assetVerification.applications?.count}
											error={assetVerification.applications?.error}
										/>
										<AssetCard
											title="Resource Servers"
											status={assetVerification.resources?.status}
											count={assetVerification.resources?.count}
											error={assetVerification.resources?.error}
										/>
										<AssetCard
											title="Scopes"
											status={assetVerification.scopes?.status}
											count={assetVerification.scopes?.count}
											error={assetVerification.scopes?.error}
										/>
										<AssetCard
											title="Users"
											status={assetVerification.users?.status}
											count={assetVerification.users?.count}
											error={assetVerification.users?.error}
										/>
									</div>
									<AssetTable
										apps={(assetVerification.applications?.data || []).filter(
											(a) => EXPECTED_APP_NAMES.includes(a.name),
										)}
										resources={(() => {
											const appData = (
												assetVerification.applications?.data || []
											).filter((a) => EXPECTED_APP_NAMES.includes(a.name));
											const usedRsIds = new Set(
												appData.flatMap((a) =>
													(a.grantedResources || []).map((rs) => rs.id),
												),
											);
											return (assetVerification.resources?.data || []).filter(
												(r) => usedRsIds.has(r.id),
											);
										})()}
										scopes={assetVerification.scopes?.data || []}
										scopesMeta={{
											isBankingRS: assetVerification.scopes?.isBankingRS,
											resourceServerName:
												assetVerification.scopes?.resourceServerName,
										}}
										users={assetVerification.users?.data || []}
										tokenPolicies={assetVerification.tokenPolicies?.data || []}
										tokenPoliciesMeta={assetVerification.tokenPolicies}
										missing={
											assetVerification.missing || {
												apps: [],
												scopesByApp: {},
												resourcesByApp: {},
											}
										}
										expectedApps={
											assetVerification.expectedApps || EXPECTED_APP_NAMES
										}
										expectedScopes={
											assetVerification.expectedScopes ||
											EXPECTED_BANKING_SCOPES
										}
									/>
									{/* Scope fix panel */}
									{assetVerification &&
										(assetVerification.missingCanonicalScopes?.length > 0 ||
											assetVerification.scopes?.isBankingRS === false) && (
											<div className="scope-fix-panel">
												<div className="scope-fix-panel__header">
													<strong>Scope Alignment Issues Detected</strong>
												</div>
												{assetVerification.scopes?.isBankingRS === false && (
													<p className="scope-fix-panel__desc">
														Banking resource server not found in PingOne. Click
														below to create it with canonical scopes.
													</p>
												)}
												{assetVerification.missingCanonicalScopes?.length >
													0 && (
													<p className="scope-fix-panel__desc">
														Missing scopes:{" "}
														{assetVerification.missingCanonicalScopes.map(
															(s) => (
																<span
																	key={s}
																	className="asset-badge asset-badge--missing"
																>
																	{s}
																</span>
															),
														)}
													</p>
												)}
												<button
													type="button"
													className="fix-btn"
													onClick={fixBankingResourceServer}
													disabled={scopeFixing}
												>
													{scopeFixing
														? "Fixing…"
														: assetVerification.scopes?.isBankingRS === false
															? "Fix: Create Banking Resource Server"
															: "Fix: Add Missing Scopes"}
												</button>
												{scopeFixResult && (
													<div
														className={`scope-fix-result ${scopeFixResult.success ? "scope-fix-result--ok" : "scope-fix-result--err"}`}
													>
														{scopeFixResult.success
															? `✓ Done — created: ${scopeFixResult.created ? "new RS" : "existing RS"}, scopes added: ${scopeFixResult.scopeResults?.filter((r) => r.success).length ?? 0}`
															: `✗ ${scopeFixResult.error}`}
													</div>
												)}
											</div>
										)}
								</>
							)}
						</div>
					)}
					<SectionApiCalls />
				</CollapsibleSection>

				{/* Token Acquisition Tests Section */}
				<CollapsibleSection title="Token Acquisition Tests" defaultOpen>
					<WhatIsHappening
						title="Token Acquisition — Authorization Code + PKCE & Client Credentials"
						steps={[
							"User clicks Login → browser redirects to PingOne /as/authorize with code_challenge (S256 PKCE)",
							"User authenticates; PingOne redirects back with one-time authorization code",
							"BFF server exchanges code + code_verifier at POST /as/token → receives access_token, id_token, refresh_token",
							"Tokens are stored server-side in Redis session — the browser never sees a raw JWT",
							"Agent Token uses Client Credentials grant: POST /as/token with client_id + client_secret → access_token only (no refresh)",
						]}
						apiFlow={[
							{
								method: "GET",
								endpoint:
									"/as/authorize?response_type=code&code_challenge=...&state=...",
								note: "Initiates PKCE login",
							},
							{
								method: "POST",
								endpoint: "/as/token (grant_type=authorization_code)",
								note: "Exchanges code for tokens",
							},
							{
								method: "POST",
								endpoint: "/as/token (grant_type=client_credentials)",
								note: "Agent/worker token",
							},
						]}
					/>
					<div className="pingone-test-grid">
						<div className="test-card-col">
							{(() => {
								const authzLabel =
									loginType === "admin"
										? "Admin Token"
										: loginType === "ai_agent"
											? "AI Agent Token"
											: loginType === "customer"
												? "Customer Token"
												: "Authorization Code Token";
								return (
									<>
										<TestCard
											title={authzLabel}
											status={authzTokenStatus}
											error={authzTokenError}
											onTest={testAuthzToken}
											config={TEST_CONFIG.authzToken}
											loginUrl={
												authzTokenStatus !== "passed"
													? "/api/auth/oauth/user/login?return_to=/pingone-test"
													: null
											}
										/>
										<TokenCard
											decoded={authzDecoded}
											title={authzLabel}
											defaultExpanded
										/>
									</>
								);
							})()}
						</div>
						<div className="test-card-col">
							<TestCard
								title="Agent Token (Client Credentials)"
								status={agentTokenStatus}
								error={agentTokenError}
								onTest={testAgentToken}
								onFix={
									agentTokenStatus === "failed"
										? () => fixIssue("single-exchange")
										: undefined
								}
								config={TEST_CONFIG.agentToken}
								testLabel="Get Token"
					pingoneRequest={agentPingoneReq}
					pingoneResponse={agentPingoneRes}
					docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
					docsSectionTitle="Token Endpoint — client_credentials (RFC 6749)"
					endpoint="POST https://auth.pingone.{region}/{envId}/as/token"
							/>
							{agentPingoneReq && (
								<ApiCallPreviewCard
									endpoint={agentPingoneReq.url || "POST https://auth.pingone.{region}/{envId}/as/token"}
									method={agentPingoneReq.method || "POST"}
									docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
									docsSectionTitle="Token Endpoint — client_credentials (RFC 6749)"
									requestBody={agentPingoneReq.body}
									responseBody={agentPingoneRes}
									responseStatus={agentPingoneRes?.status_code ?? (agentPingoneRes?.error ? 400 : agentPingoneRes ? 200 : null)}
									label="Agent Token (Client Credentials)"
								/>
							)}
							<TokenCard
								decoded={agentDecoded}
								title="Agent Token (Client Credentials)"
								defaultExpanded
							/>
						</div>
					</div>
					<SectionApiCalls />
				</CollapsibleSection>

				{/* Token Exchange Tests Section */}
				<CollapsibleSection title="Token Exchange Tests" defaultOpen>
					<TokenColorLegend />
					<WhatIsHappening
						title="RFC 8693 Token Exchange — Delegated Authorization for MCP (all flows 401-triggered)"
						steps={[
							"Token Exchange (RFC 8693) swaps one token for a narrower-scoped token without re-authenticating the user.",
							"All three flows below are triggered the same way: the MCP server returns 401 → BFF performs the exchange → retries with the MCP token.",
							"1) 2-Exchange (User Token + Agent CC): User access token as subject_token + AI Agent client-credentials token as actor_token → Ping Agent Gateway token with nested act claim proving agent identity.",
							"2) 2-Exchange (ID Token + Agent CC): User ID token as subject_token (identity assertion) + Agent CC as actor_token → Ping Agent Gateway token with act claim. Combines OIDC identity with agent delegation. Requires ff_id_token_exchange feature flag.",
							"3) Simple Exchange (Access Token → MCP Token): User access token as subject_token only (no actor). Single RFC 8693 POST → MCP-scoped token. No act claim.",
							"Key difference from #1 to #3: #1 proves which agent acted (act claim appears in MCP token); #3 is simpler but lacks agent provenance.",
							"The MCP server validates act.client_id (flows 1 & 2) to confirm the correct agent client acted on behalf of the user.",
						]}
						apiFlow={[
							{
								method: "POST",
								endpoint:
									"/as/token (grant_type=urn:ietf:params:oauth:grant-type:token-exchange)",
								note: "RFC 8693 — all three flows",
							},
							{
								method: "POST",
								endpoint:
									"/as/token subject=accessToken, actor=agentCC, audience=mcp-gateway",
								note: "Flow #1: 2-exchange user token + agent CC",
							},
							{
								method: "POST",
								endpoint:
									"/as/token subject=idToken, actor=agentCC, audience=mcp-gateway",
								note: "Flow #2: 2-exchange ID token + agent CC",
							},
							{
								method: "POST",
								endpoint: "/as/token subject=accessToken, audience=mcp-server",
								note: "Flow #3: simple access token exchange",
							},
						]}
					/>
					{authzTokenStatus === "failed" &&
						authzTokenError &&
						authzTokenError.toLowerCase().includes("log in") && (
							<div className="pingone-test-login-banner">
								<span className="pingone-test-login-banner__text">
									Token exchange requires a user access token. Log in to
									PingOne first using the Authorization Code + PKCE flow.
								</span>
								<a
									href="/api/auth/oauth/user/login?return_to=/pingone-test"
									className="pingone-test-button pingone-test-button--primary pingone-test-login-banner__btn"
								>
									Login to PingOne →
								</a>
							</div>
						)}
					<ApiCallPreviewCard
						method="POST"
						endpoint={`https://auth.pingone.${config?.region || "com"}/${config?.environmentId}/as/token`}
						requestBody={{
							grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
							subject_token: "<user_access_token>",
							subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
							actor_token: "<agent_cc_token>",
							actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
							audience: "<mcp_resource_uri>",
							scope: "read write",
						}}
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
						docsSectionTitle="RFC 8693 Token Exchange — swaps user access token + agent CC token for MCP-scoped token with act claim"
						label="Token Exchange Example"
					/>
				{/* MCP Exchange Diagnostic Panel */}
					<div className="scope-fix-panel" style={{ marginBottom: "1rem" }}>
						<div className="scope-fix-panel__header">
							<span>MCP Exchange Diagnostics</span>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								<button
									type="button"
									className="pingone-test-button pingone-test-button--secondary"
									onClick={diagnoseMcpExchange}
								>
									Diagnose
								</button>
								{mcpExchangeDiag &&
									(!mcpExchangeDiag.canExchange ||
										(mcpExchangeDiag.claimValidation &&
											!mcpExchangeDiag.claimValidation.allClaimsValid)) && (
										<button
											type="button"
											className="pingone-test-button pingone-test-button--danger"
											onClick={fixMcpExchange}
											disabled={mcpExchangeFixing}
										>
											{mcpExchangeFixing ? "Fixing…" : "🔧 Auto-Fix in PingOne"}
										</button>
									)}
							</div>
						</div>
						{mcpExchangeDiag && (
							<div style={{ fontSize: "1rem", marginTop: "0.5rem" }}>
								{mcpExchangeDiag.error && (
									<div className="scope-fix-result--err">
										Error: {mcpExchangeDiag.error}
									</div>
								)}
								{mcpExchangeDiag.success && (
									<>
										<div style={{ marginBottom: "0.4rem" }}>
											<strong>MCP RS:</strong>{" "}
											{mcpExchangeDiag.mcpResourceServer ? (
												<span className="asset-badge asset-badge--ok">
													{mcpExchangeDiag.mcpResourceServer.name}
												</span>
											) : (
												<span className="asset-badge asset-badge--warn">
													Not found for {mcpExchangeDiag.mcpUri}
												</span>
											)}
										</div>
										<div style={{ marginBottom: "0.4rem" }}>
											<strong>Exchanger App:</strong>{" "}
											{mcpExchangeDiag.exchangerApp ? (
												<span className="asset-badge asset-badge--ok">
													{mcpExchangeDiag.exchangerApp.name}
												</span>
											) : (
												<span className="asset-badge asset-badge--warn">
													Not found
												</span>
											)}{" "}
											<strong>MCP RS Assigned:</strong>{" "}
											{mcpExchangeDiag.exchangerHasMcpRS ? (
												<span className="asset-badge asset-badge--ok">Yes</span>
											) : (
												<span className="asset-badge asset-badge--warn">
													No — will fail
												</span>
											)}
										</div>
										<div style={{ marginBottom: "0.4rem" }}>
											<strong>Requested scopes:</strong>{" "}
											{(mcpExchangeDiag.requestedScopes || []).map((s) => (
												<span
													key={s}
													className={
														"asset-badge " +
														(mcpExchangeDiag.missingFromApp?.includes(s)
															? "asset-badge--missing"
															: "asset-badge--scope")
													}
												>
													{s}
												</span>
											))}
										</div>
										{mcpExchangeDiag.missingFromRS?.length > 0 && (
											<div className="scope-fix-result--err">
												Missing on MCP RS:{" "}
												{mcpExchangeDiag.missingFromRS.join(", ")}
											</div>
										)}
										{mcpExchangeDiag.missingFromApp?.length > 0 && (
											<div className="scope-fix-result--err">
												Not assigned to exchanger app:{" "}
												{mcpExchangeDiag.missingFromApp.join(", ")}
											</div>
										)}
										{mcpExchangeDiag.canExchange &&
											!mcpExchangeDiag.claimValidation?.issues?.length && (
												<div className="scope-fix-result--ok">
													✓ Exchange should work
												</div>
											)}
										{mcpExchangeDiag.canExchange &&
											mcpExchangeDiag.claimValidation?.issues?.length > 0 && (
												<div
													className="scope-fix-result--ok"
													style={{ color: "#e65100" }}
												>
													Config OK but token claims have issues
												</div>
											)}
										{mcpExchangeDiag.claimValidation && (
											<div
												style={{
													marginTop: "0.5rem",
													padding: "8px",
													background: "#fafafa",
													borderRadius: "4px",
												}}
											>
												<strong>Token Claim Validation</strong>
												{mcpExchangeDiag.claimValidation.tested ? (
													mcpExchangeDiag.claimValidation.allClaimsValid ? (
														<div style={{ color: "#2e7d32", marginTop: "4px" }}>
															All token claims validated correctly
														</div>
													) : (
														<div style={{ marginTop: "4px" }}>
															<div
																style={{ color: "#e65100", fontWeight: 600 }}
															>
																{mcpExchangeDiag.claimValidation.issues.length}{" "}
																claim issue(s) found:
															</div>
															{mcpExchangeDiag.claimValidation.issues.map(
																(issue, i) => (
																	<div
																		key={`issue-${i}-${issue}`}
																		style={{
																			margin: "4px 0",
																			padding: "4px 8px",
																			background: "#fff3e0",
																			borderLeft: "3px solid #ff9800",
																			borderRadius: "4px",
																		}}
																	>
																		<strong>{issue.claim}</strong>: expected{" "}
																		<code>
																			{JSON.stringify(issue.expected)}
																		</code>
																		, got{" "}
																		<code>{JSON.stringify(issue.actual)}</code>
																		{issue.missing && (
																			<div
																				style={{
																					fontSize: "0.85rem",
																					color: "#666",
																				}}
																			>
																				Missing: {issue.missing.join(", ")}
																			</div>
																		)}
																		<div
																			style={{
																				fontSize: "0.85rem",
																				color: "#666",
																				marginTop: "2px",
																			}}
																		>
																			Fix: {issue.fix}
																		</div>
																	</div>
																),
															)}
														</div>
													)
												) : (
													<div style={{ color: "#1565c0", marginTop: "4px" }}>
														ℹ️ {mcpExchangeDiag.claimValidation.reason}
													</div>
												)}
											</div>
										)}
										{mcpExchangeFixResult && (
											<div
												style={{
													marginTop: "0.5rem",
													borderTop: "1px solid rgba(0,0,0,0.1)",
													paddingTop: "0.5rem",
												}}
											>
												<strong>Last Fix Result:</strong>{" "}
												<span
													className={
														mcpExchangeFixResult.success
															? "asset-badge asset-badge--ok"
															: "asset-badge asset-badge--warn"
													}
												>
													{mcpExchangeFixResult.success
														? "✓ Success"
														: `✗ ${mcpExchangeFixResult.error || "Failed"}`}
												</span>
												{mcpExchangeFixResult.steps?.map((s) => (
													<div
														key={s.step}
														style={{
															fontSize: "0.85rem",
															color: "#64748b",
															marginTop: "2px",
														}}
													>
														<code>{s.step}</code>:{" "}
														<span
															className={
																s.status === "ok" ||
																s.status === "found" ||
																s.status === "created"
																	? "asset-badge asset-badge--ok"
																	: "asset-badge asset-badge--warn"
															}
														>
															{s.status || "?"}
														</span>{" "}
														{s.detail || s.error || ""}
													</div>
												))}
											</div>
										)}
									</>
								)}
							</div>
						)}
					</div>
					<div className="exchange-flow-selector">
						{EXCHANGE_FLOWS.map(({ id, label }) => (
							<button
								key={id}
								type="button"
								aria-pressed={exchangeFlow === id}
								className={`exchange-flow-selector__btn${exchangeFlow === id ? " is-active" : ""}`}
								onClick={() => setExchangeFlow(id)}
							>
								{label}
							</button>
						))}
					</div>
					<div className="pingone-test-grid">
						{/* Column 1: 2-Exchange — User Token + Agent CC (401-triggered) */}
						{exchangeFlow === "two" && (
						<div className="test-card-col">
							{(() => {
								const t1Label =
									loginType === "admin"
										? "Admin Token (T1)"
										: loginType === "ai_agent"
											? "AI Agent Token (T1)"
											: "User Token (T1)";
								return (
									<>
										<TestCard
											title={`2-Exchange: ${loginType === "admin" ? "Admin" : "User"} Token + Agent CC → Ping Agent Gateway (MCP 401-triggered)`}
											status={exchange2Status}
											error={exchange2Error}
											onTest={testExchange2}
											onFix={
												exchange2Status === "failed"
													? () => fixIssue("double-exchange")
													: undefined
											}
											config={TEST_CONFIG.exchange2}
										pingoneRequest={exchange2PingoneReq}
										pingoneResponse={exchange2PingoneRes}
										docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
										docsSectionTitle="Token Exchange (RFC 8693 — subject + actor)"
										endpoint="POST https://auth.pingone.{region}/{envId}/as/token"
										/>
										{exchange2PingoneReq && (
											<ApiCallPreviewCard
												endpoint={exchange2PingoneReq.url || "POST https://auth.pingone.{region}/{envId}/as/token"}
												method={exchange2PingoneReq.method || "POST"}
												docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
												docsSectionTitle="Token Exchange (RFC 8693 — subject + actor)"
												requestBody={exchange2PingoneReq.body}
												responseBody={exchange2PingoneRes}
												responseStatus={exchange2PingoneRes?.status_code ?? (exchange2PingoneRes?.error ? 400 : exchange2PingoneRes ? 200 : null)}
												label="2-Exchange: User Token + Agent CC → Ping Agent Gateway"
											/>
										)}
										{(exchange2SubjectDecoded || exchange2ActorDecoded) && (
											<>
												<TokenCard
													decoded={exchange2SubjectDecoded}
													title={`Subject: ${t1Label}`}
													defaultExpanded
												/>
												<TokenCard
													decoded={exchange2ActorDecoded}
													title="Actor: Agent CC Token"
													defaultExpanded
												/>
											</>
										)}
										<TokenCard
											decoded={exchange2Decoded}
											title="Ping Agent Gateway Token (2-exchange)"
											defaultExpanded
										/>
										<TokenLineageDiff
											fromDecoded={authzDecoded}
											toDecoded={exchange2Decoded}
											fromLabel={t1Label}
											toLabel="Ping Agent Gateway Token with act (2-exchange)"
											expectedChanges={[
												"aud",
												"scope",
												"client_id",
												"act",
												"may_act",
												"sid",
												"auth_time",
												"amr",
												"sub",
											]}
										/>
									</>
								);
							})()}
						</div>
						)}
						{/* Column 2: 2-Exchange — ID Token + Agent CC (401-triggered) */}
						{exchangeFlow === "id" && (
						<div className="test-card-col">
							<TestCard
								title="2-Exchange: ID Token + Agent CC → Ping Agent Gateway (MCP 401-triggered)"
								status={exchange186Status}
								error={exchange186Error}
								onTest={testExchange186}
								config={{
									appName: "Demo AI App - Token Exchanger",
									appType: "AI_AGENT",
									requiredScopes: [
										"read",
										"write",
										"mcp:invoke",
									],
									audience: "mcpserver.ping.demo",
									spel: "MCP server returns 401 → BFF uses ID token (subject) + Agent CC token (actor) → RFC 8693 dual exchange → Ping Agent Gateway token with act claim",
								}}
							pingoneRequest={exchange186PingoneReq}
							pingoneResponse={exchange186PingoneRes}
							docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
							docsSectionTitle="Token Exchange (RFC 8693 — ID token subject)"
							endpoint="POST https://auth.pingone.{region}/{envId}/as/token"
							/>
							{exchange186PingoneReq && (
								<ApiCallPreviewCard
									endpoint={exchange186PingoneReq.url || "POST https://auth.pingone.{region}/{envId}/as/token"}
									method={exchange186PingoneReq.method || "POST"}
									docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
									docsSectionTitle="Token Exchange (RFC 8693 — ID token subject)"
									requestBody={exchange186PingoneReq.body}
									responseBody={exchange186PingoneRes}
									responseStatus={exchange186PingoneRes?.status_code ?? (exchange186PingoneRes?.error ? 400 : exchange186PingoneRes ? 200 : null)}
									label="2-Exchange: ID Token + Agent CC → Ping Agent Gateway"
								/>
							)}
							{!ffIdTokenExchange && (
								<div
									className="pingone-test-ff-warning"
									style={{
										padding: "8px 12px",
										margin: "8px 0",
										background: "#fff8e1",
										borderLeft: "3px solid #ffc107",
										borderRadius: "4px",
										fontSize: "0.85rem",
									}}
								>
									<strong>ff_id_token_exchange</strong> is OFF — enable in
									Feature Flags to run this test.
								</div>
							)}
							{exchange186SubjectDecoded && (
								<TokenCard
									decoded={exchange186SubjectDecoded}
									title="Subject: User ID Token"
									defaultExpanded
								/>
							)}
							{exchange186ActorDecoded && (
								<TokenCard
									decoded={exchange186ActorDecoded}
									title="Actor: Agent CC Token"
									defaultExpanded
								/>
							)}
							{exchange186Decoded && (
								<TokenCard
									decoded={exchange186Decoded}
									title="Ping Agent Gateway Token (ID Token + Agent CC)"
									defaultExpanded
								/>
							)}
							{exchange186Decoded && exchange186SubjectDecoded && (
								<TokenLineageDiff
									fromDecoded={exchange186SubjectDecoded}
									toDecoded={exchange186Decoded}
									fromLabel="User ID Token (Subject)"
									toLabel="Ping Agent Gateway Token (ID Token 2-Exchange)"
									expectedChanges={[
										"aud",
										"scope",
										"client_id",
										"act",
										"may_act",
										"sid",
										"auth_time",
										"amr",
										"sub",
									]}
								/>
							)}
						</div>
						)}
						{/* Column 3: Simple 1-Exchange — Access Token → MCP Token (401-triggered) */}
						{exchangeFlow === "simple" && (
						<div className="test-card-col">
							<TestCard
								title="Simple Exchange: Access Token → MCP Token (MCP 401-triggered)"
								status={exchange401Status}
								error={exchange401Error}
								onTest={testExchange401}
								config={{
									appName: "Demo AI App - AI Agent Actor",
									appType: "AI_AGENT",
									requiredScopes: [
										"read",
										"write",
										"mcp:invoke",
									],
									audience: "mcpserver.ping.demo",
									spel: "User access token sent to MCP → MCP returns 401 → agent fetches CC token → RFC 8693 access token exchange → retry MCP with MCP token",
								}}
							pingoneRequest={exchange401PingoneReq}
							pingoneResponse={exchange401PingoneRes}
							docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token"
							docsSectionTitle="Token Exchange (RFC 8693 — 401 trigger)"
							endpoint="POST https://auth.pingone.{region}/{envId}/as/token"
							/>
							{exchange401Steps.length > 0 && (
								<ul
									style={{
										listStyle: "none",
										padding: "8px 0",
										margin: "8px 0",
										fontSize: "0.82rem",
									}}
								>
									{exchange401Steps.map((step) => (
										<li
											key={step.step}
											style={{
												padding: "2px 0",
												color: step.passed ? "#16a34a" : "#dc2626",
											}}
										>
											{step.passed ? "✓" : "✗"} Step {step.step}: {step.label}
											{step.received != null ? ` (HTTP ${step.received})` : ""}
										</li>
									))}
								</ul>
							)}
							{exchange401SubjectDecoded && (
								<TokenCard
									decoded={exchange401SubjectDecoded}
									title="User Access Token (Subject — causes 401)"
									defaultExpanded
								/>
							)}
							{exchange401AgentDecoded && (
								<TokenCard
									decoded={exchange401AgentDecoded}
									title="Agent Token (MCP Exchanger CC)"
									defaultExpanded
								/>
							)}
							{exchange401Decoded && (
								<TokenCard
									decoded={exchange401Decoded}
									title="MCP Token (Simple Exchange Result)"
									defaultExpanded
								/>
							)}
							{exchange401SubjectDecoded && exchange401Decoded && (
								<TokenLineageDiff
									fromDecoded={exchange401SubjectDecoded}
									toDecoded={exchange401Decoded}
									fromLabel="User Access Token (Subject)"
									toLabel="MCP Token (Simple Exchange)"
									expectedChanges={["aud", "scope", "client_id"]}
								/>
							)}
						</div>
						)}
					</div>
					<SectionApiCalls />
				</CollapsibleSection>

				{/* Environment & Resources (Configuration + Resource URIs) */}
				<CollapsibleSection title="Environment & Resources">
					<h3 className="pingone-test-subsection-title">Configuration</h3>
					<div className="pingone-test-grid">
						<TestCard
							title="Environment ID"
							value={config?.environmentId}
							status={testResults.environmentId?.status || "pending"}
							onTest={() =>
								runTest("environmentId", () => {
									if (!config?.environmentId)
										throw new Error("Missing PINGONE_ENVIRONMENT_ID");
									return Promise.resolve(config.environmentId);
								})
							}
							onFix={() => fixIssue("environmentId")}
							envVar={CONFIG_META.environmentId.envVar}
							format={CONFIG_META.environmentId.format}
							failMsg={CONFIG_META.environmentId.failMsg}
						/>
						<TestCard
							title="Region"
							value={config?.region}
							status={testResults.region?.status || "pending"}
							onTest={() =>
								runTest("region", () => {
									if (!config?.region)
										throw new Error("Missing PINGONE_REGION");
									return Promise.resolve(config.region);
								})
							}
							onFix={() => fixIssue("region")}
							envVar={CONFIG_META.region.envVar}
							format={CONFIG_META.region.format}
							failMsg={CONFIG_META.region.failMsg}
						/>
						<TestCard
							title="Admin Client ID"
							value={config?.adminClientId}
							status={testResults.adminClientId?.status || "pending"}
							onTest={() =>
								runTest("adminClientId", () => {
									if (!config?.adminClientId)
										throw new Error("Missing PINGONE_ADMIN_CLIENT_ID");
									return Promise.resolve(config.adminClientId);
								})
							}
							onFix={() => fixIssue("adminClientId")}
							envVar={CONFIG_META.adminClientId.envVar}
							format={CONFIG_META.adminClientId.format}
							failMsg={CONFIG_META.adminClientId.failMsg}
						/>
						<TestCard
							title="User Client ID"
							value={config?.userClientId}
							status={testResults.userClientId?.status || "pending"}
							onTest={() =>
								runTest("userClientId", () => {
									if (!config?.userClientId)
										throw new Error("Missing PINGONE_USER_CLIENT_ID");
									return Promise.resolve(config.userClientId);
								})
							}
							onFix={() => fixIssue("userClientId")}
							envVar={CONFIG_META.userClientId.envVar}
							format={CONFIG_META.userClientId.format}
							failMsg={CONFIG_META.userClientId.failMsg}
						/>
						<TestCard
							title="MCP Token Exchanger Client ID"
							value={config?.mcpTokenExchangerClientId}
							status={
								testResults.mcpTokenExchangerClientId?.status || "pending"
							}
							onTest={() =>
								runTest("mcpTokenExchangerClientId", () => {
									if (!config?.mcpTokenExchangerClientId)
										throw new Error("Missing MCP_TOKEN_EXCHANGER_CLIENT_ID");
									return Promise.resolve(config.mcpTokenExchangerClientId);
								})
							}
							onFix={() => fixIssue("mcpTokenExchangerClientId")}
							envVar={CONFIG_META.mcpTokenExchangerClientId.envVar}
							format={CONFIG_META.mcpTokenExchangerClientId.format}
							failMsg={CONFIG_META.mcpTokenExchangerClientId.failMsg}
						/>
						<TestCard
							title="AI Agent Client ID"
							value={config?.aiAgentClientId}
							status={testResults.aiAgentClientId?.status || "pending"}
							onTest={() =>
								runTest("aiAgentClientId", () => {
									if (!config?.aiAgentClientId)
										throw new Error("Missing AI_AGENT_CLIENT_ID");
									return Promise.resolve(config.aiAgentClientId);
								})
							}
							onFix={() => fixIssue("aiAgentClientId")}
							envVar={CONFIG_META.aiAgentClientId.envVar}
							format={CONFIG_META.aiAgentClientId.format}
							failMsg={CONFIG_META.aiAgentClientId.failMsg}
						/>
					</div>
					<h3 className="pingone-test-subsection-title">Resources</h3>
					<div className="pingone-test-grid">
						<TestCard
							title="MCP Server URI"
							value={config?.resourceMcpServerUri}
							status={testResults.resourceMcpServerUri?.status || "pending"}
							onTest={() =>
								runTest("resourceMcpServerUri", () => {
									if (!config?.resourceMcpServerUri)
										throw new Error("Missing MCP_SERVER_URI");
									return Promise.resolve(config.resourceMcpServerUri);
								})
							}
							onFix={() => fixIssue("resourceMcpServerUri")}
							envVar={CONFIG_META.resourceMcpServerUri.envVar}
							format={CONFIG_META.resourceMcpServerUri.format}
							failMsg={CONFIG_META.resourceMcpServerUri.failMsg}
						/>
						<TestCard
							title="Ping Agent Gateway URI"
							value={config?.resourceMcpGatewayUri}
							status={testResults.resourceMcpGatewayUri?.status || "pending"}
							onTest={() =>
								runTest("resourceMcpGatewayUri", () => {
									if (!config?.resourceMcpGatewayUri)
										throw new Error("Missing MCP_GATEWAY_URI");
									return Promise.resolve(config.resourceMcpGatewayUri);
								})
							}
							onFix={() => fixIssue("resourceMcpGatewayUri")}
							envVar={CONFIG_META.resourceMcpGatewayUri.envVar}
							format={CONFIG_META.resourceMcpGatewayUri.format}
							failMsg={CONFIG_META.resourceMcpGatewayUri.failMsg}
						/>
						<TestCard
							title="Agent Gateway URI"
							value={config?.resourceAgentGatewayUri}
							status={testResults.resourceAgentGatewayUri?.status || "pending"}
							onTest={() =>
								runTest("resourceAgentGatewayUri", () => {
									if (!config?.resourceAgentGatewayUri)
										throw new Error("Missing AGENT_GATEWAY_URI");
									return Promise.resolve(config.resourceAgentGatewayUri);
								})
							}
							onFix={() => fixIssue("resourceAgentGatewayUri")}
							envVar={CONFIG_META.resourceAgentGatewayUri.envVar}
							format={CONFIG_META.resourceAgentGatewayUri.format}
							failMsg={CONFIG_META.resourceAgentGatewayUri.failMsg}
						/>
					</div>
					<SectionApiCalls />
				</CollapsibleSection>

				{/* PingOne API Tests Section */}
				<CollapsibleSection title="PingOne API Tests">
					<div className="pingone-test-grid">
						<TestCard
							title="Applications"
							value={
								testResults.apps?.result?.count !== undefined
									? `${testResults.apps.result.count} apps`
									: "Test PingOne applications"
							}
							status={testResults.apps?.status || "pending"}
							onTest={() => runTest("apps", testApps)}
							onFix={() => fixIssue("apps")}
							onUpdate={() => runTest("update-apps", updateApps)}
							updateLabel="Update Apps"
							updateResult={testResults["update-apps"]}
						pingoneRequest={testResults.apps?.result?.pingoneRequest}
						pingoneResponse={testResults.apps?.result?.pingoneResponse}
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-applications"
						docsSectionTitle="Management API — List Applications"
						endpoint="GET https://api.pingone.{region}/v1/environments/{envId}/applications"
						/>
						<TestCard
							title="Resource Servers"
							value={
								testResults.resources?.result?.count !== undefined
									? `${testResults.resources.result.count} resources`
									: "Test PingOne resource servers"
							}
							status={testResults.resources?.status || "pending"}
							onTest={() => runTest("resources", testResources)}
							onFix={() => fixIssue("resources")}
							onUpdate={() => runTest("update-resources", updateResources)}
							updateLabel="Update Resources"
							updateResult={testResults["update-resources"]}
						pingoneRequest={testResults.resources?.result?.pingoneRequest}
						pingoneResponse={testResults.resources?.result?.pingoneResponse}
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-resources"
						docsSectionTitle="Management API — List Resource Servers"
						endpoint="GET https://api.pingone.{region}/v1/environments/{envId}/resources"
						/>
						<TestCard
							title="Scopes"
							value={
								testResults.scopes?.result?.count !== undefined
									? `${testResults.scopes.result.count} scopes`
									: "Test PingOne scopes"
							}
							status={testResults.scopes?.status || "pending"}
							onTest={() => runTest("scopes", testScopes)}
							onFix={() => fixIssue("scopes")}
							onUpdate={() => runTest("update-scopes", updateScopes)}
							updateLabel="Update Scopes"
							updateResult={testResults["update-scopes"]}
						pingoneRequest={testResults.scopes?.result?.pingoneRequest}
						pingoneResponse={testResults.scopes?.result?.pingoneResponse}
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-resource-scopes"
						docsSectionTitle="Management API — List Scopes"
						endpoint="GET https://api.pingone.{region}/v1/environments/{envId}/resources/{resourceId}/scopes"
						/>
						<TestCard
							title="Users"
							value={
								testResults.users?.result?.count !== undefined
									? `${testResults.users.result.count} users`
									: "Test PingOne users"
							}
							status={testResults.users?.status || "pending"}
							onTest={() => runTest("users", testUsers)}
							onFix={() => fixIssue("users")}
						pingoneRequest={testResults.users?.result?.pingoneRequest}
						pingoneResponse={testResults.users?.result?.pingoneResponse}
						docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-users"
						docsSectionTitle="Management API — List Users"
						endpoint="GET https://api.pingone.{region}/v1/environments/{envId}/users"
						/>
						<TestCard
							title="AI Agent Apps"
							value={(() => {
								const r = testResults["ai-agent-apps"]?.result;
								if (!r) return "Fetch AI_AGENT type apps from PingOne";
								const missing = r.missingExpected?.length
									? ` — missing: ${r.missingExpected.join(", ")}`
									: "";
								return `${r.count} AI_AGENT apps (of ${r.totalApps} total)${missing}`;
							})()}
							status={testResults["ai-agent-apps"]?.status || "pending"}
							onTest={() => runTest("ai-agent-apps", testAiAgentApps)}
							onFix={() => fixIssue("apps")}
							onUpdate={() => runTest("update-apps", updateApps)}
							updateLabel="Update AI Apps"
							updateResult={testResults["update-apps"]}
						/>
						<TestCard
							title="User SPEL / may_act"
							value={
								testResults["update-user-spel"]?.result?.message ||
								"Set mayAct.sub on current user record"
							}
							status={testResults["update-user-spel"]?.status || "pending"}
							onUpdate={() => runTest("update-user-spel", updateUserSpel)}
							updateLabel="Set may_act"
							updateResult={testResults["update-user-spel"]}
						/>
					</div>
					<SectionApiCalls />
				</CollapsibleSection>

				{/* Scope Narrowing & Last Mile Vault Education */}
				<CollapsibleSection title="Agentic Trust — Scope Narrowing & Last Mile">
					<ScopeNarrowingVisualization />
				</CollapsibleSection>

				{/* Session Summary */}
				<CollapsibleSection title="Session Summary">
					<SessionSummary
						tests={[
							{ label: "Authorization Code Token", status: authzTokenStatus },
							{ label: "Agent CC Token", status: agentTokenStatus },
							{
								label: "2-Exchange: User Token + Agent CC",
								status: exchange2Status,
							},
							{
								label: "2-Exchange: ID Token + Agent CC",
								status: exchange186Status,
							},
							{
								label: "Simple Exchange (401-triggered)",
								status: exchange401Status,
							},
							...Object.entries(testResults).map(([key, val]) => ({
								label: key,
								status: val.status,
							})),
						]}
					/>
				</CollapsibleSection>
			</div>
		</div>
	);
}

function SessionSummary({ tests }) {
	const passed = tests.filter((t) => t.status === "passed").length;
	const failed = tests.filter((t) => t.status === "failed").length;
	const pending = tests.filter(
		(t) => t.status !== "passed" && t.status !== "failed",
	).length;

	const hasTests = tests.some((t) => t.status !== "pending");

	return (
		<div className="session-summary">
			<div className="session-summary-counts">
				<div
					className="session-summary-count passed"
					style={{ flex: 1, textAlign: "center", padding: "1rem" }}
				>
					<div
						style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#28a745" }}
					>
						{passed}
					</div>
					<div style={{ fontSize: "0.9rem", color: "#666" }}>Passed</div>
				</div>
				<div
					className="session-summary-count failed"
					style={{ flex: 1, textAlign: "center", padding: "1rem" }}
				>
					<div
						style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#dc3545" }}
					>
						{failed}
					</div>
					<div style={{ fontSize: "0.9rem", color: "#666" }}>Failed</div>
				</div>
				<div
					className="session-summary-count pending"
					style={{ flex: 1, textAlign: "center", padding: "1rem" }}
				>
					<div
						style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#999" }}
					>
						{pending}
					</div>
					<div style={{ fontSize: "0.9rem", color: "#666" }}>Pending</div>
				</div>
			</div>

			{!hasTests && (
				<p style={{ textAlign: "center", color: "#888", padding: "1rem" }}>
					Run tests above to see results here.
				</p>
			)}

			{hasTests && (
				<div className="session-summary-list" style={{ padding: "1rem" }}>
					{tests.filter((t) => t.status === "passed").length > 0 && (
						<div className="summary-group" style={{ marginBottom: "1rem" }}>
							<h4 style={{ color: "#28a745", margin: "0.5rem 0 0.5rem 0" }}>
								✓ Passed
							</h4>
							{tests
								.filter((t) => t.status === "passed")
								.map((t) => (
									<div
										key={t.label}
										style={{
											color: "#28a745",
											paddingLeft: "1rem",
											fontSize: "0.9rem",
										}}
									>
										• {t.label}
									</div>
								))}
						</div>
					)}

					{tests.filter((t) => t.status === "failed").length > 0 && (
						<div className="summary-group" style={{ marginBottom: "1rem" }}>
							<h4 style={{ color: "#dc3545", margin: "0.5rem 0 0.5rem 0" }}>
								✗ Failed
							</h4>
							{tests
								.filter((t) => t.status === "failed")
								.map((t) => (
									<div
										key={t.label}
										style={{
											color: "#dc3545",
											paddingLeft: "1rem",
											fontSize: "0.9rem",
										}}
									>
										• {t.label}
									</div>
								))}
						</div>
					)}

					{tests.filter((t) => t.status !== "passed" && t.status !== "failed")
						.length > 0 && (
						<div className="summary-group">
							<h4 style={{ color: "#999", margin: "0.5rem 0 0.5rem 0" }}>
								— Pending
							</h4>
							{tests
								.filter((t) => t.status !== "passed" && t.status !== "failed")
								.map((t) => (
									<div
										key={t.label}
										style={{
											color: "#999",
											paddingLeft: "1rem",
											fontSize: "0.9rem",
										}}
									>
										• {t.label}
									</div>
								))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function SectionApiCalls() {
	const [open, setOpen] = React.useState(false);
	return (
		<div className="section-api-calls">
			<button
				type="button"
				className="section-api-toggle"
				onClick={() => setOpen((o) => !o)}
			>
				{open ? "▾ Hide API Calls" : "▸ Show API Calls"}
			</button>
			{open && <ApiCallDisplay sessionId="pingone-test" />}
		</div>
	);
}

const TestCard = ({
	title,
	status,
	error,
	onTest,
	onFix,
	onUpdate,
	updateLabel,
	updateResult,
	value,
	config,
	loginUrl,
	testLabel,
	envVar,
	format,
	failMsg,
	pingoneRequest,
	pingoneResponse,
	docsUrl,
	docsSectionTitle,
	endpoint,
	label,
}) => {
	const [testing, setTesting] = React.useState(false);
	const [updating, setUpdating] = React.useState(false);
	const [showingPrompt, setShowingPrompt] = React.useState(false);
	const [displayedPrompt, setDisplayedPrompt] = React.useState("");

	const handleTest = async () => {
		if (!onTest) return;
		const prompt = config?.agentPrompt;
		if (prompt && !showingPrompt) {
			// Show the prompt with typewriter effect, then auto-send
			setShowingPrompt(true);
			setDisplayedPrompt("");
			let i = 0;
			await new Promise((resolve) => {
				const timer = setInterval(() => {
					i++;
					setDisplayedPrompt(prompt.slice(0, i));
					if (i >= prompt.length) {
						clearInterval(timer);
						setTimeout(resolve, 800); // pause after typing before auto-send
					}
				}, 30);
			});
			// Auto-fire the exchange
			setTesting(true);
			try {
				await onTest();
			} finally {
				setTesting(false);
			}
			return;
		}
		setTesting(true);
		try {
			await onTest();
		} finally {
			setTesting(false);
		}
	};

	const handleUpdate = async () => {
		if (!onUpdate) return;
		setUpdating(true);
		try {
			await onUpdate();
		} finally {
			setUpdating(false);
		}
	};

	const statusLabel = {
		passed: "✓ passed",
		failed: "✗ failed",
		running: "⟳ testing",
		pending: "— pending",
	};
	const updateStatus = updateResult?.status;

	return (
		<div className={`test-card test-card--${status}`}>
			<div className="test-card-header">
				<h3 className="test-card-title">{title}</h3>
				<span className={`test-card-status test-card-status--${status}`}>
					{statusLabel[status] || status}
				</span>
			</div>
			{showingPrompt && config?.agentPrompt && (
				<div className="test-card-prompt-bubble">
					<span className="prompt-bubble-label">Agent prompt →</span>
					<span className="prompt-bubble-text">
						{displayedPrompt}
						<span className="prompt-cursor">|</span>
					</span>
				</div>
			)}
			{value && <p className="test-card-value">{value}</p>}
			{updateResult?.result && (
				<div
					className={`test-card-update-result test-card-update-result--${updateStatus}`}
				>
					{updateStatus === "passed"
						? "✓ "
						: updateStatus === "failed"
							? "✗ "
							: ""}
					{updateResult.result.message ||
						updateResult.result.steps
							?.map(
								(s) =>
									`${s.rs || s.app || s.step}: ${s.status || s.detail || (s.added?.length ? `+${s.added.join(", ")}` : "ok")}`,
							)
							.join("; ") ||
						updateResult.result.results
							?.map((r) => `${r.rs}: +${(r.added || []).join(", ") || "none"}`)
							.join("; ") ||
						(updateStatus === "passed" ? "Done" : updateResult.error || "")}
				</div>
			)}
			{(envVar || format) && (
				<div className="test-card-detail">
					{envVar && (
						<div className="test-card-detail__row">
							<span className="detail-label">Env var:</span>
							<code className="detail-code">{envVar}</code>
						</div>
					)}
					{format && (
						<div className="test-card-detail__row">
							<span className="detail-label">Format:</span>
							<span className="detail-text">{format}</span>
						</div>
					)}
					{status === "failed" && failMsg && (
						<div className="test-card-detail__fix">{failMsg}</div>
					)}
				</div>
			)}
			{error && <div className="test-card-error">{error}</div>}
			{config && (
				<div className="test-card-config">
					<div className="config-item">
						<span className="config-label">App:</span>
						<span className="config-value">{config.appName}</span>
					</div>
					<div className="config-item">
						<span className="config-label">Type:</span>
						<span className="config-value">{config.appType}</span>
					</div>
					{config.requiredScopes && (
						<div className="config-item">
							<span className="config-label">Scopes:</span>
							<span className="config-value">
								{config.requiredScopes.join(", ")}
							</span>
						</div>
					)}
					{config.audience && (
						<div className="config-item">
							<span className="config-label">Audience:</span>
							<span className="config-value">{config.audience}</span>
						</div>
					)}
					{config.spel && (
						<div className="config-item">
							<span className="config-label">Flow:</span>
							<span className="config-value">{config.spel}</span>
						</div>
					)}
				</div>
			)}
			<div className="test-card-actions">
				{loginUrl && (
					<a
						href={loginUrl}
						className="pingone-test-button pingone-test-button--primary"
					>
						Login to PingOne →
					</a>
				)}
				{onTest && (
					<button
						type="button"
						className="pingone-test-button pingone-test-button--secondary"
						onClick={handleTest}
						disabled={testing || status === "running"}
					>
						{testing || status === "running"
							? "Exchanging tokens…"
							: showingPrompt
								? "Sending…"
								: config?.agentPrompt
									? testLabel || "Send Prompt"
									: testLabel || "Test"}
					</button>
				)}
				{onUpdate && (
					<button
						type="button"
						className="pingone-test-button pingone-test-button--update"
						onClick={handleUpdate}
						disabled={updating}
						title={`Apply changes to PingOne: ${updateLabel || "Update"}`}
					>
						{updating ? "Updating…" : updateLabel || "Update"}
					</button>
				)}
				{onFix && (
					<button
						type="button"
						className="pingone-test-button pingone-test-button--fix"
						onClick={onFix}
					>
						Fix in PingOne ↗
					</button>
				)}
			</div>
			<PingOneApiPanel request={pingoneRequest} response={pingoneResponse} docsUrl={docsUrl} docsSectionTitle={docsSectionTitle} />
		</div>
	);
};

function TokenLineageDiff({
	fromDecoded,
	toDecoded,
	fromLabel,
	toLabel,
	expectedChanges,
}) {
	const [open, setOpen] = React.useState(false);
	if (!fromDecoded?.payload || !toDecoded?.payload) return null;

	const from = fromDecoded.payload;
	const to = toDecoded.payload;
	const allKeys = Array.from(
		new Set([...Object.keys(from), ...Object.keys(to)]),
	);
	const SKIP = ["jti", "nbf", "iat", "exp", "at_hash"];
	const rows = allKeys
		.filter((k) => !SKIP.includes(k))
		.map((k) => {
			const fv = from[k];
			const tv = to[k];
			const fStr =
				fv !== undefined
					? typeof fv === "object"
						? JSON.stringify(fv)
						: String(fv)
					: undefined;
			const tStr =
				tv !== undefined
					? typeof tv === "object"
						? JSON.stringify(tv)
						: String(tv)
					: undefined;
			let kind;
			if (fStr === undefined) kind = "added";
			else if (tStr === undefined) kind = "removed";
			else if (fStr !== tStr) kind = "changed";
			else kind = "same";
			const expected = expectedChanges ? expectedChanges.includes(k) : false;
			return { k, fStr, tStr, kind, expected };
		})
		.sort((a, b) => {
			// Unexpected changes first, then expected changes, then same
			const aOrder =
				a.kind === "same"
					? 3
					: a.expected
						? 2.5
						: { changed: 0, added: 1, removed: 2 }[a.kind];
			const bOrder =
				b.kind === "same"
					? 3
					: b.expected
						? 2.5
						: { changed: 0, added: 1, removed: 2 }[b.kind];
			return aOrder - bOrder;
		});

	const changed = rows.filter((r) => r.kind !== "same");
	const same = rows.filter((r) => r.kind === "same");
	const unexpected = changed.filter((r) => !r.expected);
	const expectedCount = changed.filter((r) => r.expected).length;

	return (
		<div className="tld-wrapper">
			<button
				type="button"
				className="tld-toggle"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="tld-icon">{open ? "\u25BC" : "\u25B6"}</span>
				<span className="tld-label">
					🔀 Token Lineage Diff — {fromLabel || "Input"} → {toLabel || "Output"}
				</span>
				{unexpected.length > 0 && (
					<span className="tld-badge tld-badge--unexpected">
						{unexpected.length} unexpected
					</span>
				)}
				{expectedCount > 0 && (
					<span className="tld-badge tld-badge--expected">
						{expectedCount} expected
					</span>
				)}
				{changed.length > 0 && !expectedChanges && (
					<span className="tld-badge">
						{changed.length} claim{changed.length !== 1 ? "s" : ""} changed
					</span>
				)}
			</button>
			{open && (
				<div className="tld-body">
					<div className="tld-headers">
						<span className="tld-col-label tld-col--from">
							{fromLabel || "Input Token"}
						</span>
						<span className="tld-col-label tld-col--to">
							{toLabel || "Output Token"}
						</span>
					</div>
					{changed.map(({ k, fStr, tStr, kind, expected }) => (
						<div
							key={k}
							className={`tld-row tld-row--${kind} ${expected ? "tld-row--expected" : "tld-row--unexpected"}`}
						>
							<span className="tld-claim-key">{k}</span>
							<span
								className={`tld-kind-badge tld-kind--${kind} ${expected ? "tld-expected" : "tld-unexpected"}`}
							>
								{kind}
								{expected ? " \u2713" : ""}
							</span>
							<div className="tld-values">
								{fStr !== undefined && (
									<code className="tld-val tld-val--from">{fStr}</code>
								)}
								{kind === "changed" && <span className="tld-arrow">→</span>}
								{tStr !== undefined && (
									<code className="tld-val tld-val--to">{tStr}</code>
								)}
							</div>
						</div>
					))}
					{same.length > 0 && (
						<details className="tld-same-details">
							<summary className="tld-same-summary">
								{same.length} unchanged claim{same.length !== 1 ? "s" : ""}
							</summary>
							{same.map(({ k, fStr }) => (
								<div key={k} className="tld-row tld-row--same">
									<span className="tld-claim-key">{k}</span>
									<span className="tld-kind-badge tld-kind--same">same</span>
									<div className="tld-values">
										<code className="tld-val tld-val--same">{fStr}</code>
									</div>
								</div>
							))}
						</details>
					)}
				</div>
			)}
		</div>
	);
}

function WhatIsHappening({ title, steps, apiFlow }) {
	const [open, setOpen] = React.useState(false);
	return (
		<div className="what-is-happening">
			<button
				type="button"
				className="wih-toggle"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="wih-icon">{open ? "▼" : "▶"}</span>
				<span className="wih-label">
					ℹ️ {title || "What is happening here?"}
				</span>
			</button>
			{open && (
				<div className="wih-body">
					{steps && (
						<ol className="wih-steps">
							{steps.map((s) => (
								<li key={s}>{s}</li>
							))}
						</ol>
					)}
					{apiFlow && (
						<div className="wih-api">
							<div className="wih-api-title">API Calls Involved</div>
							{apiFlow.map((a) => (
								<div key={`${a.method}-${a.endpoint}`} className="wih-api-row">
									<span
										className={`wih-method wih-method--${a.method?.toLowerCase()}`}
									>
										{a.method}
									</span>
									<code className="wih-endpoint">{a.endpoint}</code>
									{a.note && <span className="wih-note">{a.note}</span>}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function AssetCard({ title, status, count, error }) {
	return (
		<div className="asset-card">
			<div className="asset-card-header">
				<h3 className="asset-card-title">{title}</h3>
				<span className={`asset-card-status asset-card-status--${status}`}>
					{status}
				</span>
			</div>
			<div className="asset-card-content">
				<p className="asset-card-count">
					{count !== undefined ? `${count} found` : "—"}
				</p>
				{error && <p className="asset-card-error">{error}</p>}
			</div>
		</div>
	);
}

function AssetTable({
	apps,
	resources,
	scopes,
	scopesMeta,
	users,
	tokenPolicies,
	tokenPoliciesMeta,
	missing,
	expectedApps: _expectedApps,
	expectedScopes,
}) {
	const [activeTab, setActiveTab] = React.useState("apps");
	const [appNameFilter, setAppNameFilter] = React.useState("");
	const [appTypeFilter, setAppTypeFilter] = React.useState("");
	const appTypes = React.useMemo(
		() => [...new Set(apps.map((a) => a.type).filter(Boolean))].sort(),
		[apps],
	);
	const filteredApps = React.useMemo(
		() =>
			apps.filter((a) => {
				if (
					appNameFilter &&
					!(a.name || "").toLowerCase().includes(appNameFilter.toLowerCase())
				)
					return false;
				if (appTypeFilter && a.type !== appTypeFilter) return false;
				return true;
			}),
		[apps, appNameFilter, appTypeFilter],
	);
	const missingAppNames = missing.apps || [];
	const rsBankingLabel = scopesMeta?.resourceServerName
		? `${scopesMeta.resourceServerName}${scopesMeta.isBankingRS ? " (banking)" : ""}`
		: null;
	const TABS = [
		{ id: "apps", label: `Apps (${apps.length})` },
		{ id: "resources", label: `Resources (${(resources || []).length})` },
		{ id: "scopes", label: `Scopes (${(scopes || []).length})` },
		{ id: "users", label: `Users (${(users || []).length})` },
		{ id: "spel", label: `SPEL/Policies (${(tokenPolicies || []).length})` },
		{ id: "grants", label: "Grants Matrix" },
	];

	return (
		<div className="asset-table-wrapper">
			<h3 className="asset-table-title">PingOne Entity Explorer</h3>
			<div className="asset-tabs">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`asset-tab ${activeTab === t.id ? "asset-tab--active" : ""}`}
						onClick={() => setActiveTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>

			{activeTab === "apps" && (
				<div style={{ overflowX: "auto" }}>
					<div
						className="asset-filter-bar"
						style={{
							display: "flex",
							gap: "0.75rem",
							alignItems: "center",
							marginBottom: "0.5rem",
							flexWrap: "wrap",
						}}
					>
						<input
							type="text"
							placeholder="Filter by name…"
							value={appNameFilter}
							onChange={(e) => setAppNameFilter(e.target.value)}
							style={{
								padding: "0.35rem 0.6rem",
								borderRadius: "6px",
								border: "1px solid #334155",
								background: "#0f172a",
								color: "#e2e8f0",
								fontSize: "0.82rem",
								minWidth: "160px",
							}}
						/>
						<select
							value={appTypeFilter}
							onChange={(e) => setAppTypeFilter(e.target.value)}
							style={{
								padding: "0.35rem 0.6rem",
								borderRadius: "6px",
								border: "1px solid #334155",
								background: "#0f172a",
								color: "#e2e8f0",
								fontSize: "0.82rem",
							}}
						>
							<option value="">All types</option>
							{appTypes.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</select>
						{(appNameFilter || appTypeFilter) && (
							<span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
								{filteredApps.length} of {apps.length} apps
							</span>
						)}
					</div>
					<table className="asset-table">
						<thead>
							<tr>
								<th className="asset-table-th">Application</th>
								<th className="asset-table-th">Type</th>
								<th className="asset-table-th">Resource Servers</th>
								<th className="asset-table-th">Scopes Granted</th>
								<th className="asset-table-th">Status</th>
							</tr>
						</thead>
						<tbody>
							{filteredApps.map((app) => {
								const missingScopesForApp = missing.scopesByApp?.[app.id] || [];
								const hasIssue = missingScopesForApp.length > 0;
								return (
									<tr
										key={app.id}
										className={
											hasIssue ? "asset-table-row--warn" : "asset-table-row--ok"
										}
									>
										<td className="asset-table-td asset-table-td--name">
											{app.name}
										</td>
										<td className="asset-table-td">
											<span className="asset-badge asset-badge--type">
												{app.type || "—"}
											</span>
										</td>
										<td className="asset-table-td">
											{app.grantedResources &&
											app.grantedResources.length > 0 ? (
												app.grantedResources.map((rs) => (
													<div key={rs.id} className="asset-rs-name">
														{rs.name}
													</div>
												))
											) : (
												<span className="asset-badge asset-badge--warn">
													No resources assigned
												</span>
											)}
										</td>
										<td className="asset-table-td">
											{app.grantedResources &&
											app.grantedResources
												.flatMap((rs) => rs.scopes || [])
												.filter((s) => typeof s === "string").length > 0
												? app.grantedResources
														.flatMap((rs) => rs.scopes || [])
														.filter((s) => typeof s === "string")
														.map((scope) => (
															<span
																key={scope}
																className={
																	"asset-badge " +
																	(missingScopesForApp.includes(scope)
																		? "asset-badge--missing"
																		: "asset-badge--scope")
																}
															>
																{scope}
															</span>
														))
												: expectedScopes.map((scope) => (
														<span
															key={scope}
															className="asset-badge asset-badge--missing"
														>
															{scope} &#x2717;
														</span>
													))}
										</td>
										<td className="asset-table-td">
											{hasIssue ? (
												<span className="asset-badge asset-badge--warn">
													&#9888; Incomplete
												</span>
											) : (
												<span className="asset-badge asset-badge--ok">
													&#10003; OK
												</span>
											)}
										</td>
									</tr>
								);
							})}
							{missingAppNames.map((name) => (
								<tr key={name} className="asset-table-row--missing">
									<td
										className="asset-table-td asset-table-td--name"
										style={{ color: "#b91c1c", fontStyle: "italic" }}
									>
										{name}
									</td>
									<td className="asset-table-td">
										<span className="asset-badge asset-badge--missing">
											App not found
										</span>
									</td>
									<td
										className="asset-table-td"
										colSpan={2}
										style={{ color: "#b91c1c", fontSize: "0.8rem" }}
									>
										Expected app not found in PingOne.
									</td>
									<td className="asset-table-td">
										<span className="asset-badge asset-badge--missing">
											&#x2717; MISSING
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{activeTab === "resources" && (
				<div style={{ overflowX: "auto" }}>
					<table className="asset-table">
						<thead>
							<tr>
								<th className="asset-table-th">Resource Server</th>
								<th className="asset-table-th">Audience / URI</th>
								<th className="asset-table-th">Type</th>
								<th className="asset-table-th">ID</th>
							</tr>
						</thead>
						<tbody>
							{(resources || []).map((rs) => (
								<tr key={rs.id} className="asset-table-row--ok">
									<td className="asset-table-td asset-table-td--name">
										{rs.name}
									</td>
									<td className="asset-table-td">
										<code style={{ fontSize: "0.75rem" }}>
											{rs.audience || rs.accessControl?.audience || "—"}
										</code>
									</td>
									<td className="asset-table-td">
										<span className="asset-badge asset-badge--type">
											{rs.type || "—"}
										</span>
									</td>
									<td className="asset-table-td">
										<code style={{ fontSize: "0.7rem", color: "#888" }}>
											{rs.id}
										</code>
									</td>
								</tr>
							))}
							{(!resources || resources.length === 0) && (
								<tr>
									<td
										colSpan={4}
										className="asset-table-td"
										style={{ textAlign: "center", color: "#888" }}
									>
										No resource servers found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}

			{activeTab === "scopes" && (
				<div style={{ overflowX: "auto" }}>
					{rsBankingLabel && (
						<div className="asset-rs-banner asset-rs-banner--banking">
							Resource Server: <strong>{rsBankingLabel}</strong>
						</div>
					)}
					<table className="asset-table">
						<thead>
							<tr>
								<th className="asset-table-th">Scope Name</th>
								<th className="asset-table-th">Description</th>
								<th className="asset-table-th">ID</th>
							</tr>
						</thead>
						<tbody>
							{(scopes || []).map((scope) => (
								<tr key={scope.id} className="asset-table-row--ok">
									<td className="asset-table-td asset-table-td--name">
										<span className="asset-badge asset-badge--scope">
											{scope.name}
										</span>
									</td>
									<td
										className="asset-table-td"
										style={{ fontSize: "0.8rem", color: "#555" }}
									>
										{scope.description || "—"}
									</td>
									<td className="asset-table-td">
										<code style={{ fontSize: "0.7rem", color: "#888" }}>
											{scope.id}
										</code>
									</td>
								</tr>
							))}
							{(!scopes || scopes.length === 0) && (
								<tr>
									<td
										colSpan={3}
										className="asset-table-td"
										style={{ textAlign: "center", color: "#888" }}
									>
										No scopes found
										{rsBankingLabel ? ` on ${rsBankingLabel}` : ""}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}

			{activeTab === "users" && (
				<div style={{ overflowX: "auto" }}>
					<table className="asset-table">
						<thead>
							<tr>
								<th className="asset-table-th">Username</th>
								<th className="asset-table-th">Email</th>
								<th className="asset-table-th">Name</th>
								<th className="asset-table-th">MFA Enabled</th>
								<th className="asset-table-th">Status</th>
							</tr>
						</thead>
						<tbody>
							{(users || []).map((user) => (
								<tr key={user.id} className="asset-table-row--ok">
									<td className="asset-table-td asset-table-td--name">
										{user.username || user.email || "—"}
									</td>
									<td className="asset-table-td" style={{ fontSize: "0.8rem" }}>
										{user.email?.address || user.email || "—"}
									</td>
									<td className="asset-table-td" style={{ fontSize: "0.8rem" }}>
										{user.name?.given} {user.name?.family}
									</td>
									<td className="asset-table-td">
										<span
											className={`asset-badge ${user.mfaEnabled ? "asset-badge--ok" : "asset-badge--warn"}`}
										>
											{user.mfaEnabled ? "✓ Yes" : "— No"}
										</span>
									</td>
									<td className="asset-table-td">
										<span
											className={`asset-badge ${user.enabled !== false ? "asset-badge--ok" : "asset-badge--missing"}`}
										>
											{user.enabled !== false ? "Active" : "Disabled"}
										</span>
									</td>
								</tr>
							))}
							{(!users || users.length === 0) && (
								<tr>
									<td
										colSpan={5}
										className="asset-table-td"
										style={{ textAlign: "center", color: "#888" }}
									>
										No users found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}

			{activeTab === "spel" && (
				<div>
					{(tokenPolicies || []).length === 0 ? (
						<p style={{ padding: "1rem", color: "#888" }}>
							{tokenPoliciesMeta?.status === "insufficient_scope" ? (
								<>Missing scope: worker token needs <code>p1:read:environment:tokenPolicies</code>.</>
							) : tokenPoliciesMeta?.status === "not_available" ? (
								<>Token policies unavailable{tokenPoliciesMeta.error ? `: ${tokenPoliciesMeta.error}` : ". Check worker token permissions."}
								</>
							) : (
								<>No token policies found in this environment.</>
							)}
						</p>
					) : (
						(tokenPolicies || []).map((policy) => (
							<div key={policy.id} className="spel-policy-card">
								<div className="spel-policy-name">{policy.name}</div>
								<div className="spel-policy-meta">
									<span className="asset-badge asset-badge--type">
										ID: {policy.id}
									</span>
								</div>
								{policy.claimAttributeMappings &&
									policy.claimAttributeMappings.length > 0 && (
										<div className="spel-claims">
											<div className="spel-claims-title">
												Claim Attribute Mappings (SPEL)
											</div>
											{policy.claimAttributeMappings.map((m) => (
												<div
													key={m.attributeName || m.claim || m.id}
													className="spel-claim-row"
												>
													<span className="spel-claim-name">
														{m.attributeName || m.claim || "?"}
													</span>
													<code className="spel-claim-expr">
														{m.attributeValue ||
															m.value ||
															m.expression ||
															JSON.stringify(m)}
													</code>
												</div>
											))}
										</div>
									)}
							</div>
						))
					)}
				</div>
			)}

			{activeTab === "grants" && (
				<div style={{ overflowX: "auto" }}>
					<table className="asset-table">
						<thead>
							<tr>
								<th className="asset-table-th">Application</th>
								<th className="asset-table-th">Resource</th>
								<th className="asset-table-th">Scopes</th>
							</tr>
						</thead>
						<tbody>
							{apps.flatMap((app) =>
								app.grants && app.grants.length > 0
									? app.grants.map((g, i) => (
											<tr
												key={`${app.id}-${i}`}
												className="asset-table-row--ok"
											>
												{i === 0 && (
													<td
														className="asset-table-td asset-table-td--name"
														rowSpan={app.grants.length}
													>
														{app.name}
													</td>
												)}
												<td className="asset-table-td">
													{g.resourceName || g.resourceId || "—"}
												</td>
												<td className="asset-table-td">
													{(g.scopes || []).map((s) => (
														<span
															key={s}
															className="asset-badge asset-badge--scope"
														>
															{s}
														</span>
													))}
												</td>
											</tr>
										))
									: [
											<tr key={app.id} className="asset-table-row--warn">
												<td className="asset-table-td asset-table-td--name">
													{app.name}
												</td>
												<td className="asset-table-td" colSpan={2}>
													<span className="asset-badge asset-badge--warn">
														No grants configured
													</span>
												</td>
											</tr>,
										],
							)}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
