import React from "react";
import "./GatewayRoutingDiagram.css";

// Visualises what the Agent Gateway is actually doing, driven by its live
// config (GET /admin/config safe-view, forwarded by the BFF as mock.liveConfig).
// Falls back to the page's generated config for the fields the live read shares
// so the diagram still renders a useful shape when the gateway is offline.
//
// Routing is by TOOL NAME -> backend target (demo_mcp_gateway/src/router.ts).
// The five targets and their example tools are static gateway knowledge; the
// addresses / audiences come from the live config.

function val(...candidates) {
	for (const c of candidates) {
		if (c !== undefined && c !== null && c !== "") return c;
	}
	return null;
}

function Field({ label, value }) {
	return (
		<div className="grd-field">
			<span className="grd-field-k">{label}</span>
			<code className="grd-field-v">{value || "—"}</code>
		</div>
	);
}

function Stage({ active, state, title, desc }) {
	return (
		<div className={`grd-stage ${active ? "grd-stage--on" : "grd-stage--off"}`}>
			<div className="grd-stage-head">
				<span className="grd-stage-title">{title}</span>
				<span className={`grd-pill ${active ? "grd-pill--on" : "grd-pill--off"}`}>{state}</span>
			</div>
			<p className="grd-stage-desc">{desc}</p>
		</div>
	);
}

function RouteCard({ name, transport, tools, fields, disabled }) {
	return (
		<div className={`grd-route ${disabled ? "grd-route--disabled" : ""}`}>
			<div className="grd-route-head">
				<span className="grd-route-name">{name}</span>
				<span className={`grd-badge grd-badge--${transport === "WebSocket" ? "ws" : "http"}`}>{transport}</span>
			</div>
			{fields.map((f) => <Field key={f.label} label={f.label} value={f.value} />)}
			<div className="grd-route-tools">
				<span className="grd-field-k">Example tools</span>
				<div className="grd-tool-chips">
					{tools.map((t) => <code key={t} className="grd-tool-chip">{t}</code>)}
				</div>
			</div>
		</div>
	);
}

export default function GatewayRoutingDiagram({ live, config, mock }) {
	const c = config || {};
	const l = live || {};
	const m = mock || {};

	const devBypass = (l.devBypass !== undefined ? l.devBypass : m.devBypass) === true;
	const passthrough = l.mcpServerPassthrough === true;
	const p1azEndpoint = val(l.pingAuthorizeEndpoint, c.pingAuthorizeEndpoint);
	const p1azOn = (l.p1azEnabled === true) || (!("p1azEnabled" in l) && !!p1azEndpoint);
	const hitlUrl = val(l.hitlServiceUrl, c.hitlServiceUrl);

	const inboundAud = val(l.gatewayResourceUri, c.gatewayResourceUri);

	const routes = [
		{
			name: "Online Banking",
			transport: "WebSocket",
			tools: ["get_my_accounts", "create_transfer", "get_my_transactions"],
			fields: [
				{ label: "Backend", value: val(l.mcpOlbWsUrl, c.upstreamMcpUrl) },
				{ label: "Exchange aud", value: val(l.mcpOlbResourceUri, c.mcpOlbResourceUri) },
			],
		},
		{
			name: "Investments",
			transport: "WebSocket",
			tools: ["get_portfolio_summary", "get_investment_balance"],
			fields: [
				{ label: "Backend", value: val(l.mcpResourceServerWsUrl, c.mcpResourceServerWsUrl) },
				{ label: "Exchange aud", value: val(l.mcpResourceServerResourceUri, c.mcpResourceServerResourceUri) },
			],
		},
		{
			name: "API-key (per vertical)",
			transport: "HTTP",
			tools: ["show_mortgage", "show_health_record", "show_permit"],
			fields: [
				{ label: "Backend", value: l.apiResourceServerBaseUrl ? `${l.apiResourceServerBaseUrl}/{route}` : null },
				{ label: "Credential", value: "X-API-Key (not exposed)" },
			],
		},
		{
			name: "Dual-token",
			transport: "HTTP",
			tools: ["user_profile_card"],
			fields: [
				{ label: "Backend", value: l.bankingResourceServerBaseUrl ? `${l.bankingResourceServerBaseUrl}/api/resource-server/identity` : null },
				{ label: "Exchange aud", value: l.bankingResourceServerResourceUri },
			],
		},
		{
			name: "Banking-data",
			transport: "HTTP",
			tools: ["demo_show_accounts", "demo_show_transactions"],
			fields: [
				{ label: "Backend", value: l.bankingResourceServerBaseUrl ? `${l.bankingResourceServerBaseUrl}/api/resource-server/{accounts|transactions}` : null },
				{ label: "Exchange aud", value: l.bankingResourceServerResourceUri },
			],
		},
	];

	return (
		<div className="grd-root">
			<p className="grd-caption">
				Live topology — how the gateway routes a tool call. {live
					? "Addresses and audiences are read live from the gateway."
					: "Gateway offline — showing generated config; live HTTP-backend routes unavailable."}
			</p>

			<div className={`grd-flow ${devBypass ? "grd-flow--bypass" : ""}`}>
				{/* Source */}
				<div className="grd-col grd-col--source">
					<div className="grd-node grd-node--source">
						<span className="grd-node-title">AI Agent / BFF</span>
						<Field label="Inbound token aud" value={inboundAud} />
						<p className="grd-node-note">Token must carry this audience to be accepted.</p>
					</div>
				</div>

				<div className="grd-arrow" aria-hidden="true">›</div>

				{/* Gateway pipeline */}
				<div className="grd-col grd-col--gateway">
					<div className="grd-gateway">
						<div className="grd-gateway-head">Demo Agent Gateway</div>
						{devBypass && (
							<div className="grd-bypass-banner">
								Dev Bypass ON — pipeline skipped, inbound token forwarded unchanged
							</div>
						)}
						<Stage
							active={!devBypass}
							state={devBypass ? "skipped" : "on"}
							title="1 · Token introspection"
							desc="RFC 7662 active-token check (always-on; endpoint not in live config)."
						/>
						<Stage
							active={!devBypass && p1azOn}
							state={devBypass ? "skipped" : p1azOn ? "PERMIT / DENY" : "permit-all"}
							title="2 · PingOne Authorize"
							desc={p1azOn ? `Per-call policy at ${p1azEndpoint}` : "No endpoint — permit-all."}
						/>
						<Stage
							active={!devBypass && !!hitlUrl}
							state={devBypass ? "skipped" : hitlUrl ? "on INDETERMINATE" : "off"}
							title="3 · HITL challenge"
							desc={hitlUrl ? `Human approval via ${hitlUrl}` : "Not configured — no step-up."}
						/>
						<Stage
							active={!devBypass && !passthrough}
							state={devBypass ? "skipped" : passthrough ? "passthrough" : "on"}
							title="4 · RFC 8693 exchange"
							desc={passthrough
								? "Passthrough — inbound token forwarded unchanged."
								: "Mints a backend-scoped token (aud = route audience)."}
						/>
					</div>
				</div>

				<div className="grd-arrow" aria-hidden="true">›</div>

				{/* Backends */}
				<div className="grd-col grd-col--backends">
					{routes.map((r) => (
						<RouteCard key={r.name} {...r} disabled={!r.fields.some((f) => f.value)} />
					))}
				</div>
			</div>
		</div>
	);
}
