// demo_api_ui/src/utils/pingOneConsoleUrl.js
// PingOne admin console sign-on URLs must include ?env=ENVIRONMENT_ID.
// The legacy /edit/{envId}/# form is rejected with "Invalid Sign-on URL".

/**
 * Build a PingOne admin console URL for the given environment.
 * @param {string | null | undefined} envId
 * @param {string} [hashPath] Optional in-console hash route (e.g. "/application/list").
 * @returns {string | null} Console URL, or null when envId is missing.
 */
export function pingOneConsoleUrl(envId, hashPath = "") {
	if (!envId) return null;
	const home = `https://console.pingone.com/?env=${encodeURIComponent(envId)}`;
	if (!hashPath) return home;
	const path = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
	return `${home}#${path}`;
}
