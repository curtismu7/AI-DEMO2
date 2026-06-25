import React, { useState } from "react";
import "./ApiCallPreviewCard.css";

/**
 * ApiCallPreviewCard — reusable PingOne API transparency card.
 *
 * Shows for a single PingOne API call:
 *   1. Method + endpoint URL (always visible)
 *   2. Status badge (green=2xx, red=4xx/5xx, grey=no data)
 *   3. Collapsible: full request JSON
 *   4. Collapsible: full response JSON
 *   5. Link to PingOne developer docs
 */
export default function ApiCallPreviewCard({
	endpoint,
	method,
	docsUrl,
	docsSectionTitle,
	requestBody = null,
	responseBody = null,
	responseStatus = null,
	durationMs = null,
	defaultOpen = false,
	label,
}) {
	const [reqOpen, setReqOpen] = useState(defaultOpen);
	const [resOpen, setResOpen] = useState(defaultOpen);

	const hasData = requestBody != null || responseBody != null;
	const statusClass =
		responseStatus == null
			? "api-preview-status--none"
			: responseStatus >= 200 && responseStatus < 300
			? "api-preview-status--ok"
			: "api-preview-status--err";

	const fmtJson = (val) => {
		if (val == null) return null;
		if (typeof val === "string") return val;
		try {
			return JSON.stringify(val, null, 2);
		} catch {
			return String(val);
		}
	};

	const reqJson = fmtJson(requestBody);
	const resJson = fmtJson(responseBody);

	return (
		<div className="api-preview-card">
			<div className="api-preview-card__header">
				<div className="api-preview-card__title">
					<span className="api-preview-method">{method}</span>
					<code className="api-preview-endpoint">{endpoint}</code>
				</div>
				<div className="api-preview-card__meta">
					{responseStatus != null && (
						<span className={`api-preview-status ${statusClass}`}>
							{responseStatus}
						</span>
					)}
					{durationMs != null && (
						<span className="api-preview-duration">{durationMs}ms</span>
					)}
					{docsUrl && (
						<a
							href={docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="api-preview-docs-link"
							title={docsSectionTitle || "PingOne API docs"}
						>
							PingOne docs &rarr;
						</a>
					)}
				</div>
			</div>

			{label && <div className="api-preview-card__label">{label}</div>}

			{!hasData && (
				<div className="api-preview-no-data">
					No live data yet — run the action above to see the actual request and response.
				</div>
			)}

			{reqJson != null && (
				<div className="api-preview-section">
					<button
						type="button"
						className="api-preview-toggle"
						onClick={() => setReqOpen((o) => !o)}
					>
						{reqOpen ? "▾ Hide Request JSON" : "▸ Show Request JSON"}
					</button>
					{reqOpen && (
						<pre className="api-preview-body api-preview-body--request">{reqJson}</pre>
					)}
				</div>
			)}

			{resJson != null && (
				<div className="api-preview-section">
					<button
						type="button"
						className="api-preview-toggle"
						onClick={() => setResOpen((o) => !o)}
					>
						{resOpen ? "▾ Hide Response JSON" : "▸ Show Response JSON"}
					</button>
					{resOpen && (
						<pre className={`api-preview-body api-preview-body--response ${statusClass}`}>{resJson}</pre>
					)}
				</div>
			)}
		</div>
	);
}
