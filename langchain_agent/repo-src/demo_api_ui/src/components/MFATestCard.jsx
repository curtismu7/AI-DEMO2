import React, { useState } from "react";
import PingOneApiPanel from "./PingOneApiPanel";
import JsonHighlight from "./shared/JsonHighlight";

/**
 * MFATestCard — Simplified test card for MFA testing
 * Flow: API Preview → Test Button → Results (after test)
 * Shows actual API request/response after test completes
 */
export default function MFATestCard({
	title,
	status,
	error,
	onTest,
	testLabel = "Test",
	endpoint,
	method = "POST",
	docsUrl,
	docsSectionTitle,
	pingoneRequest,
	pingoneResponse,
	rawResult,
}) {
	const [testing, setTesting] = useState(false);
	const [rawOpen, setRawOpen] = useState(false);

	const handleTest = async () => {
		if (!onTest) return;
		setTesting(true);
		try {
			await onTest();
		} finally {
			setTesting(false);
		}
	};

	const statusLabel = {
		passed: "Passed",
		failed: "Failed",
		running: "Testing",
		pending: "Pending",
	};

	return (
		<div className={`mfa-test-card mfa-test-card--${status}`}>
			{/* API Preview Section */}
			<div className="mfa-test-card__api-preview">
				<div className="mfa-test-card__api-header">
					<span className={`mfa-test-card__method mfa-test-card__method--${method.toLowerCase()}`}>
						{method}
					</span>
					<code className="mfa-test-card__endpoint">{endpoint}</code>
					{docsUrl && (
						<a
							href={docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="mfa-test-card__docs-link"
							title={docsSectionTitle}
						>
							Docs
						</a>
					)}
				</div>
			</div>

			{/* Test Button */}
			<div className="mfa-test-card__actions">
				<button
					type="button"
					className="mfa-test-button mfa-test-button--primary"
					onClick={handleTest}
					disabled={testing || status === "running"}
				>
					{testing || status === "running" ? "Testing…" : testLabel}
				</button>
				<span className={`mfa-test-card__status mfa-test-card__status--${status}`}>
					{statusLabel[status] || status}
				</span>
			</div>

			{/* Results Section (only shown after test) */}
			{status !== "pending" && status !== "running" && (
				<div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
					{status === "passed" && (
						<div className="mfa-test-card__success-badge">Success</div>
					)}
					{error && (
						<div className="mfa-test-card__error-message">
							<strong>Error:</strong> {error}
						</div>
					)}
					{status === "passed" && !error && (
						<div className="mfa-test-card__success-message">
							Test completed successfully
						</div>
					)}
					{/* API Request/Response after test */}
					{(pingoneRequest || pingoneResponse) && (
						<PingOneApiPanel
							request={pingoneRequest}
							response={pingoneResponse}
							endpoint={endpoint}
							docsUrl={docsUrl}
							docsSectionTitle={docsSectionTitle}
						/>
					)}
					{/* Raw result fallback */}
					{!pingoneResponse && rawResult !== undefined && rawResult !== null && (
						<div className="test-card-raw">
							<button
								type="button"
								className="test-card-raw-toggle"
								onClick={() => setRawOpen((o) => !o)}
							>
								{rawOpen ? "▾ Hide P1 Response" : "▸ Show P1 Response"}
							</button>
							{rawOpen && (
								<pre className="test-card-raw-json">
									<JsonHighlight value={rawResult} />
								</pre>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
