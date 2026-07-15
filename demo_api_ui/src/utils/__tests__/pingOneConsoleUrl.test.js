// demo_api_ui/src/utils/__tests__/pingOneConsoleUrl.test.js
import { pingOneConsoleUrl } from "../pingOneConsoleUrl";

describe("pingOneConsoleUrl", () => {
	it("returns null when environment id is missing", () => {
		expect(pingOneConsoleUrl(null)).toBeNull();
		expect(pingOneConsoleUrl(undefined)).toBeNull();
		expect(pingOneConsoleUrl("")).toBeNull();
	});

	it("builds the required ?env= sign-on URL", () => {
		expect(pingOneConsoleUrl("abc-123")).toBe(
			"https://console.pingone.com/?env=abc-123",
		);
	});

	it("encodes the environment id for the query string", () => {
		expect(pingOneConsoleUrl("a b")).toBe(
			"https://console.pingone.com/?env=a%20b",
		);
	});

	it("appends an in-console hash route after ?env=", () => {
		expect(pingOneConsoleUrl("abc-123", "/application/list")).toBe(
			"https://console.pingone.com/?env=abc-123#/application/list",
		);
		expect(pingOneConsoleUrl("abc-123", "users/list")).toBe(
			"https://console.pingone.com/?env=abc-123#/users/list",
		);
	});

	it("does not use the retired /edit/{envId}/# sign-on form", () => {
		const url = pingOneConsoleUrl("abc-123", "/application/list");
		expect(url).not.toMatch(/\/edit\//);
	});
});
