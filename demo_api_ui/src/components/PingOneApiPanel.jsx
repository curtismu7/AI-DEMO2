/**
 * PingOneApiPanel — shared collapsible PingOne API request + response panels.
 *
 * Props:
 *   request  — { method, url, contentType?, body } — the outgoing PingOne API call
 *   response — any JSON-serialisable value          — the raw PingOne response body
 *   endpoint — OPTIONAL { method: string, url: string }
 *              Always-visible badge above the toggle. Falls back to request.method/url
 *              when absent and request is present. Omit to render as before.
 *   docsUrl  — OPTIONAL string — URL to PingOne API docs for this call type.
 *              Renders a "PingOne Docs ↗" link next to the endpoint badge.
 */
import React, { useState } from "react";
import "./PingOneApiPanel.css";

/** Classify a Content-Type value for visual validation. */
function _ctCheck(contentType) {
	if (!contentType) return null;
	const ct = String(contentType);
	if (ct.includes("vnd.pingidentity")) return { level: "ok", label: "✓ PingOne vendor type" };
	if (ct.includes("application/json")) return { level: "info", label: "ℹ JSON" };
	if (ct.includes("x-www-form-urlencoded")) return { level: "info", label: "ℹ form-encoded" };
	return { level: "warn", label: "⚠ unexpected" };
}

export default function PingOneApiPanel({ request, response, endpoint, docsUrl, docsSectionTitle }) {
	const [reqOpen, setReqOpen] = useState(false);
	const [resOpen, setResOpen] = useState(false);

	if (!request && !response) return null;

	// Derive badge from explicit endpoint prop, or from the request object itself.
	const badge = endpoint || (request?.method && request?.url
		? { method: request.method, url: request.url }
		: null);

	// Always-visible content-type check (from headers if present, else contentType field).
	const displayCt = request?.headers?.["Content-Type"] || request?.contentType || null;
	const ctCheck = _ctCheck(displayCt);

	return (
		<>
			{badge && (
				<div className="p1-api-panel-endpoint-badge">
					<span className="p1-api-panel-method">{badge.method}</span>
					<span className="p1-api-panel-endpoint-url">{badge.url}</span>
					{docsUrl && (
						<a
							href={docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="p1-api-panel-docs-link"
							title={docsSectionTitle || "PingOne API docs"}
						>
							PingOne Docs ↗
						</a>
					)}
				</div>
			)}
			{!badge && docsUrl && (
				<div className="p1-api-panel-endpoint-badge">
					<a
						href={docsUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="p1-api-panel-docs-link"
					>
						PingOne Docs ↗
					</a>
				</div>
			)}
			{ctCheck && (
				<div className={`p1-api-panel-ct-check p1-api-panel-ct-check--${ctCheck.level}`}>
					<span className="p1-api-panel-ct-label">Content-Type →</span>{" "}
					<code className="p1-api-panel-ct-value">{displayCt}</code>{" "}
					<span className="p1-api-panel-ct-badge">{ctCheck.label}</span>
				</div>
			)}
			{request && (
				<div className="p1-api-panel">
					<button
						type="button"
						className="p1-api-panel-toggle"
						onClick={() => setReqOpen((o) => !o)}
					>
						{reqOpen ? "▾ Hide PingOne Request" : "▸ Show PingOne Request"}
					</button>
					{reqOpen && (
						<>
							<div className="p1-api-panel-meta">
								<strong>{request.method}</strong> {request.url}
								{!request.headers && request.contentType && (
									<span>
										{" "}— <code>{request.contentType}</code>
									</span>
								)}
							</div>
							{request.headers && (
								<div className="p1-api-panel-headers">
									{Object.entries(request.headers).map(([k, v]) => (
										<div key={k} className="p1-api-panel-header-row">
											<span className="p1-api-panel-header-key">{k}:</span>{" "}
											<code className="p1-api-panel-header-val">{v}</code>
										</div>
									))}
								</div>
							)}
							<pre className="p1-api-panel-body">
								{JSON.stringify(request.body, null, 2)}
							</pre>
						</>
					)}
				</div>
			)}
			{response && (
				<div className="p1-api-panel">
					<button
						type="button"
						className="p1-api-panel-toggle"
						onClick={() => setResOpen((o) => !o)}
					>
						{resOpen ? "▾ Hide PingOne Response" : "▸ Show PingOne Response"}
					</button>
					{resOpen && (
						<pre className="p1-api-panel-body">
							{JSON.stringify(response, null, 2)}
						</pre>
					)}
				</div>
			)}
		</>
	);
}
