/**
 * parsePingcliResults — turns a pingcli JSON envelope into the friendly
 * results-table model shown above the terminal pane on the PingCLI page.
 */
import { parsePingcliResults, tokenizeJson } from "../PingCliPage";

const envelope = (data, extra = {}) =>
  JSON.stringify({ schemaVersion: "1.0", status: "success", message: "Read all successful", data, ...extra });

describe("parsePingcliResults", () => {
  it("parses a success envelope into columns and rows", () => {
    const raw = envelope([
      { _links: { self: { href: "x" } }, id: "env-1", name: "Prod", region: "NA", type: "PRODUCTION", license: { id: "l" } },
      { id: "env-2", name: "Dev", region: "NA", type: "SANDBOX" },
    ]);
    const r = parsePingcliResults(raw);
    expect(r.status).toBe("success");
    expect(r.message).toBe("Read all successful");
    expect(r.rows).toHaveLength(2);
    // preferred columns present in data, in preferred order; _links and nested objects dropped
    expect(r.columns).toEqual(["name", "id", "type", "region"]);
    expect(r.rows[0]).toEqual({ id: "env-1", name: "Prod", region: "NA", type: "PRODUCTION" });
  });

  it("caps columns at 6, preferring the well-known ones", () => {
    const raw = envelope([
      { name: "a", id: "1", type: "t", region: "NA", enabled: true, description: "d", extra1: "x", extra2: "y" },
    ]);
    const r = parsePingcliResults(raw);
    expect(r.columns).toHaveLength(6);
    expect(r.columns).toEqual(["name", "id", "type", "region", "enabled", "description"]);
  });

  it("returns null for plain text output (e.g. config list-keys)", () => {
    expect(parsePingcliResults("Valid Keys:\n- auth.storage.type")).toBeNull();
  });

  it("returns null for JSON that is not a pingcli envelope", () => {
    expect(parsePingcliResults(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parsePingcliResults(JSON.stringify({ schemaVersion: "1.0", data: null }))).toBeNull();
  });

  it("carries the error status through for error envelopes", () => {
    const raw = JSON.stringify({ schemaVersion: "1.0", status: "error", message: "", data: [] });
    const r = parsePingcliResults(raw);
    expect(r.status).toBe("error");
    expect(r.rows).toEqual([]);
  });

  it("unwraps data._embedded collections from pingone api responses", () => {
    const raw = JSON.stringify({
      schemaVersion: "1.1",
      status: "success",
      message: "Custom request successful",
      data: {
        _embedded: {
          users: [
            {
              id: "u-1",
              username: "alice",
              email: "a@example.com",
              enabled: true,
              name: { formatted: "Alice Example", given: "Alice", family: "Example" },
            },
          ],
        },
      },
    });
    const r = parsePingcliResults(raw);
    expect(r.status).toBe("success");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      id: "u-1",
      username: "alice",
      email: "a@example.com",
      enabled: true,
      name: "Alice Example",
    });
    expect(r.columns).toEqual(expect.arrayContaining(["name", "username", "email", "id", "enabled"]));
  });
});

describe("tokenizeJson", () => {
  it("pretty-prints large JSON as a single text node (no span flood)", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: `g-${i}`,
      name: `Group ${i}`,
      _links: { self: { href: `https://example.com/groups/g-${i}` } },
    }));
    const raw = JSON.stringify({
      schemaVersion: "1.1",
      status: "success",
      data: { _embedded: { groups: rows } },
    });
    const nodes = tokenizeJson(raw);
    expect(nodes).not.toBeNull();
    expect(nodes).toHaveLength(1);
    expect(typeof nodes[0]).toBe("string");
    expect(nodes[0].length).toBeGreaterThan(24000);
  });
});
