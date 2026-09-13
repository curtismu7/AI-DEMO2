# DaVinci Widget Developer Lesson Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/davinci-login-guide` into a developer lesson for the DaVinci widget — every API call, the PingOne/DaVinci wiring, the flow's final node, tokens-to-session, and pi.flow as the contrast — on the shared `components/lesson/` shell, with a live Call Inspector and a post-sign-in run summary.

**Architecture:** The page mirrors `/davinci-sdk-login` file for file. A fetch wrapper (`lib/davinciWidgetTrace.js`) records the widget's calls while it runs; `CallInspector` renders them live beside the widget; `WidgetLessonSections` holds the teaching sections; `WidgetRunSummary` is the "What just happened" modal body. `DavinciLoginWidget` installs the trace and reports sign-in instead of navigating away. No server change.

**Tech Stack:** React 19, Vite 8, vitest + @testing-library/react (jsdom), mermaid (via `useMermaidRender`), `components/lesson` (from #3260), `DraggableModal`.

**Spec:** `docs/superpowers/specs/2026-09-13-davinci-widget-lesson-design.md`

## Global Constraints

- Work in a worktree off current `origin/main` (which contains #3245 and #3260). Stage files explicitly; never `git add -A`.
- Section ids and order, exactly: `try-it-live`, `overview`, `how-its-wired`, `pi-flow`, `how-it-works`, `api-calls`, `the-flow`, `the-final-node`, `tokens-to-session`, `security`, `troubleshooting`, `in-this-repo`.
- Import lesson primitives from `../lesson` (components) or `../components/lesson` (pages): `LessonLayout, Section, CodeBlock, TableBlock, MermaidFigure, OnThisRun, Status, Lede, LessonFoot`. Lists use `className="lesson-list"`. Never edit `components/lesson/*`, `SdkWalkthrough.jsx`, `SdkLessonSections.jsx`, `StepInspector.jsx` or `DavinciSdkLoginPage.*` (owned by session ai-demo2-35).
- Never display or record: request/response bodies, `interactionId`, `interactiontoken`, access/ID/session tokens, nonce, form values, cookies. Public configuration ids in paths (environment, policy, connection) are allowed.
- CSS: every colour a `--th-*` token, font sizes from the scale (`--font-size-*`, floor `--font-size-3xs`), radii from `--radius-*`, no inline themeable styles (THEMING.md H1–H3). Page-level sticky elements use `top: calc(var(--topnav-height, 60px) + 1rem)`.
- Emoji: only `Status` renders ✓ / ⚠️ (allowlisted). Add no other emoji.
- Modals: `DraggableModal`, body wrapped in `<div className="dm-scroll">`.
- Tests: vitest from `demo_api_ui` using `./node_modules/.bin/vitest run <file>` (never `npx`). Run `bash scripts/bootstrap-worktree.sh` once in the new worktree first.

---

### Task 1: Widget call trace (`lib/davinciWidgetTrace.js`)

**Files:**
- Create: `demo_api_ui/src/lib/davinciWidgetTrace.js`
- Test: `demo_api_ui/src/lib/__tests__/davinciWidgetTrace.test.js`

**Interfaces:**
- Produces: `installWidgetTrace(onCall: (call) => void, target = window) => uninstall: () => void`; a `call` is `{ method: string, host: string, path: string, status: number, capabilityName: string|null, connectorId: string|null, success: true|null }`.
- Produces: `summarizeWidgetTrace(calls: call[]) => { calls, started: boolean, capabilityPosts: number, finalCapability: string|null, tokensReturned: boolean, session: call|null, authorizeCalls: number }`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/lib/__tests__/davinciWidgetTrace.test.js
import { describe, it, expect, vi } from "vitest";
import { installWidgetTrace, summarizeWidgetTrace } from "../davinciWidgetTrace";

const json = (body, status = 200) => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
  clone() { return { json: async () => body }; },
});

function fakeWindow(responses) {
  const calls = [];
  const target = {
    location: { origin: "https://local.ping-devops.com:4000" },
    fetch: vi.fn(async (input, init) => { calls.push([input, init]); return responses.shift(); }),
  };
  return { target, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("installWidgetTrace", () => {
  it("records method, host, path, status and only the allowed response fields", async () => {
    const { target } = fakeWindow([
      json({ interactionId: "INTERACTION-SECRET", capabilityName: "customHTMLTemplate", screen: {} }),
    ]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    await target.fetch("https://auth.pingone.com/env-1/davinci/policy/pol-1/start", {
      method: "POST",
      headers: { Authorization: "Bearer SDK-TOKEN-SECRET" },
    });
    await tick();

    expect(onCall).toHaveBeenCalledWith({
      method: "POST",
      host: "auth.pingone.com",
      path: "/env-1/davinci/policy/pol-1/start",
      status: 200,
      capabilityName: "customHTMLTemplate",
      connectorId: null,
      success: null,
    });
    expect(JSON.stringify(onCall.mock.calls)).not.toMatch(/SECRET/);
  });

  it("keeps success and connectorId from the final node, never the tokens", async () => {
    const { target } = fakeWindow([
      json({
        success: true,
        access_token: "AT-SECRET",
        id_token: "ID-SECRET",
        sessionToken: "ST-SECRET",
        capabilityName: "returnSuccessResponseWidget",
        connectorId: "pingOneAuthenticationConnector",
      }),
    ]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    await target.fetch("https://auth.pingone.com/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", { method: "POST" });
    await tick();

    expect(onCall.mock.calls[0][0]).toMatchObject({
      success: true,
      capabilityName: "returnSuccessResponseWidget",
      connectorId: "pingOneAuthenticationConnector",
    });
    expect(JSON.stringify(onCall.mock.calls)).not.toMatch(/SECRET/);
  });

  it("returns the original response untouched and ignores unrelated calls", async () => {
    const other = json({ ok: true });
    const { target } = fakeWindow([other]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    const res = await target.fetch("/api/verticals/list");
    await tick();

    expect(res).toBe(other);
    expect(onCall).not.toHaveBeenCalled();
  });

  it("records the page's own BFF calls, and restores fetch on uninstall", async () => {
    const { target } = fakeWindow([json({ ok: true })]);
    const original = target.fetch;
    const onCall = vi.fn();
    const uninstall = installWidgetTrace(onCall, target);

    await target.fetch("/api/davinci-login/widget-session", { method: "POST" });
    await tick();
    uninstall();

    expect(onCall.mock.calls[0][0]).toMatchObject({ host: "local.ping-devops.com:4000", path: "/api/davinci-login/widget-session", status: 200 });
    expect(target.fetch).toBe(original);
  });
});

describe("summarizeWidgetTrace", () => {
  const CALLS = [
    { method: "POST", host: "local", path: "/api/davinci-login/sdk-token", status: 200, capabilityName: null, connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/policy/pol-1/start", status: 200, capabilityName: "customHTMLTemplate", connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", status: 200, capabilityName: "customHTMLTemplate", connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", status: 200, capabilityName: "returnSuccessResponseWidget", connectorId: "pingOneAuthenticationConnector", success: true },
    { method: "POST", host: "local", path: "/api/davinci-login/widget-session", status: 200, capabilityName: null, connectorId: null, success: null },
  ];

  it("reports the run a developer just watched", () => {
    expect(summarizeWidgetTrace(CALLS)).toMatchObject({
      started: true,
      capabilityPosts: 2,
      finalCapability: "returnSuccessResponseWidget",
      tokensReturned: true,
      session: { status: 200 },
      authorizeCalls: 0,
    });
  });

  it("claims nothing for an empty run", () => {
    expect(summarizeWidgetTrace([])).toMatchObject({
      started: false, capabilityPosts: 0, finalCapability: null, tokensReturned: false, session: null, authorizeCalls: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/davinciWidgetTrace.test.js`
Expected: FAIL — `Failed to resolve import "../davinciWidgetTrace"`.

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_ui/src/lib/davinciWidgetTrace.js
// Records the DaVinci widget's own API calls while it runs, for the Call
// Inspector and the run summary on /davinci-login-guide.
//
// davinci.js makes every flow call with fetch — on the run captured 2026-09-13,
// POST /davinci/policy/{policyId}/start and each /capabilities/... POST were
// resource type "fetch" — so only fetch is wrapped.
//
// Recorded per call: method, host, path, HTTP status and, from JSON responses,
// capabilityName, connectorId and success. Never recorded: request or response
// bodies, interactionId, interactiontoken, tokens, nonce, form values, cookies.
// The body is read from a clone after the response is handed back, so the
// widget's own read is untouched and never delayed.

const WATCHED = [/\/davinci\//, /\/as\//, /\/api\/davinci-login\//];

const pick = (data) => ({
  capabilityName: typeof data?.capabilityName === "string" ? data.capabilityName : null,
  connectorId: typeof data?.connectorId === "string" ? data.connectorId : null,
  success: data?.success === true ? true : null,
});

/**
 * Wrap target.fetch until the returned function is called.
 * @param {(call: object) => void} onCall
 * @param {Window} [target]
 * @returns {() => void} uninstall
 */
export function installWidgetTrace(onCall, target = window) {
  const original = target.fetch;

  target.fetch = async function tracedFetch(input, init) {
    const response = await original.call(this, input, init);
    let url = null;
    try {
      url = new URL(typeof input === "string" ? input : input?.url, target.location?.origin);
    } catch {
      return response;
    }
    if (!WATCHED.some((re) => re.test(url.pathname))) return response;

    const record = {
      method: String(init?.method || input?.method || "GET").toUpperCase(),
      host: url.host,
      path: url.pathname,
      status: response.status,
      ...pick(null),
    };
    const type = response.headers?.get?.("content-type") || "";
    if (type.includes("json")) {
      response
        .clone()
        .json()
        .then((data) => onCall({ ...record, ...pick(data) }), () => onCall(record));
    } else {
      onCall(record);
    }
    return response;
  };

  return () => {
    target.fetch = original;
  };
}

/** What the Call Inspector's summary and the run summary report. */
export function summarizeWidgetTrace(calls = []) {
  const list = (calls || []).filter(Boolean);
  const flow = list.filter((c) => c.path.includes("/davinci/"));
  const final = [...flow].reverse().find((c) => c.capabilityName) || null;
  return {
    calls: list,
    started: flow.some((c) => /\/davinci\/policy\/[^/]+\/start$/.test(c.path)),
    capabilityPosts: flow.filter((c) => c.path.includes("/capabilities/")).length,
    finalCapability: final?.capabilityName || null,
    tokensReturned: flow.some((c) => c.capabilityName === "returnSuccessResponseWidget" && c.success === true),
    session: list.find((c) => c.path.endsWith("/api/davinci-login/widget-session")) || null,
    authorizeCalls: list.filter((c) => c.path.endsWith("/as/authorize")).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/davinciWidgetTrace.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/lib/davinciWidgetTrace.js demo_api_ui/src/lib/__tests__/davinciWidgetTrace.test.js
git commit -m "feat(davinci-widget): record the widget's API calls for the lesson"
```

---

### Task 2: Call Inspector (`components/davinci/CallInspector.jsx`)

**Files:**
- Create: `demo_api_ui/src/components/davinci/CallInspector.jsx`
- Test: `demo_api_ui/src/components/davinci/__tests__/CallInspector.test.jsx`

**Interfaces:**
- Consumes: the `call` shape from Task 1.
- Produces: `default CallInspector({ calls = [] })`; `callTitle(call) => string`; `callKind(call) => "sdk-token" | "start" | "screen" | "final" | "session" | "authorize" | "other"`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/davinci/__tests__/CallInspector.test.jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CallInspector, { callKind, callTitle } from "../CallInspector";

const call = (path, extra = {}) => ({
  method: "POST", host: "auth.pingone.com", path, status: 200, capabilityName: null, connectorId: null, success: null, ...extra,
});

const RUN = [
  call("/api/davinci-login/sdk-token", { host: "local.ping-devops.com:4000" }),
  call("/env-1/davinci/policy/pol-1/start", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", {
    capabilityName: "returnSuccessResponseWidget", connectorId: "pingOneAuthenticationConnector", success: true,
  }),
  call("/api/davinci-login/widget-session", { host: "local.ping-devops.com:4000" }),
];

describe("callKind", () => {
  it("names each call the widget run makes", () => {
    expect(RUN.map(callKind)).toEqual(["sdk-token", "start", "screen", "final", "session"]);
    expect(callKind(call("/env-1/as/authorize"))).toBe("authorize");
  });
});

describe("callTitle", () => {
  it("is the method and full address", () => {
    expect(callTitle(RUN[1])).toBe("POST auth.pingone.com/env-1/davinci/policy/pol-1/start");
  });
});

describe("CallInspector", () => {
  it("renders one card per call, in order, with what each call did", () => {
    const { container } = render(<CallInspector calls={RUN} />);
    const cards = container.querySelectorAll(".dvl-call");
    expect(cards).toHaveLength(5);
    expect(cards[0].textContent).toContain("mints a DaVinci SDK token");
    expect(cards[1].textContent).toContain("Bearer");
    expect(cards[3].textContent).toContain("returnSuccessResponseWidget");
    // The card's first .lesson-ok is its HTTP status; the tokens status comes after it.
    expect([...cards[3].querySelectorAll(".lesson-ok")].map((e) => e.textContent).join(" ")).toContain("tokens");
    expect(cards[4].textContent).toContain("verifies both");
  });

  it("warns on a failed call", () => {
    const { container } = render(<CallInspector calls={[{ ...RUN[4], status: 401 }]} />);
    expect(container.querySelector(".lesson-warn").textContent).toContain("HTTP 401");
  });

  it("says what to expect before the widget starts", () => {
    const { container } = render(<CallInspector calls={[]} />);
    expect(container.textContent).toContain("No calls yet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/CallInspector.test.jsx`
Expected: FAIL — `Failed to resolve import "../CallInspector"`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// demo_api_ui/src/components/davinci/CallInspector.jsx
// Call Inspector: one card per API call on /davinci-login-guide, built live from
// what crossed the wire in this browser (lib/davinciWidgetTrace.js).
//
// Each card answers: which call was this, did it succeed, and what did it do in
// the widget sign-in. Only method, address, status and the response's
// capabilityName/connectorId/success are ever shown — never bodies, tokens,
// interaction ids, nonce or form values.
import { Status } from "../lesson";

export function callKind(call) {
  const p = call?.path || "";
  if (p.endsWith("/api/davinci-login/sdk-token")) return "sdk-token";
  if (p.endsWith("/api/davinci-login/widget-session")) return "session";
  if (/\/davinci\/policy\/[^/]+\/start$/.test(p)) return "start";
  if (p.includes("/capabilities/")) {
    return call.capabilityName === "returnSuccessResponseWidget" ? "final" : "screen";
  }
  if (p.endsWith("/as/authorize")) return "authorize";
  return "other";
}

export function callTitle(call) {
  return `${call.method} ${call.host}${call.path}`;
}

function CallRole({ call }) {
  switch (callKind(call)) {
    case "sdk-token":
      return (
        <p>
          The page asks its BFF for widget config. The BFF mints a DaVinci SDK token with its API key
          (<code>X-SK-API-KEY</code>, never sent to the browser) and arms a one-time nonce it keeps in
          the session.
        </p>
      );
    case "start":
      return (
        <p>
          davinci.js starts flow policy <code>{call.path.split("/policy/")[1]?.split("/")[0]}</code> with
          the SDK token as a <code>Bearer</code> token. DaVinci runs the flow to its first screen and
          returns it as JSON (<code>capabilityName: {call.capabilityName || "…"}</code>), setting the{" "}
          <code>interactionId</code> cookie.
        </p>
      );
    case "screen":
      return (
        <p>
          A screen submit. davinci.js posts the button and form values with{" "}
          <code>eventName: &quot;continue&quot;</code> plus the <code>interactionid</code> and{" "}
          <code>interactiontoken</code> headers. DaVinci runs the flow to its next screen and returns it
          (<code>capabilityName: {call.capabilityName || "…"}</code>).
        </p>
      );
    case "final":
      return (
        <p>
          The last submit. The flow reached its final node, PingOne Authentication&rsquo;s{" "}
          <strong>Return Success Response (Widget Flows)</strong> (
          <code>capabilityName: returnSuccessResponseWidget</code>), which created the PingOne session
          and answered with <code>id_token</code> and <code>access_token</code>. davinci.js hands that
          response to <code>successCallback</code>.
        </p>
      );
    case "session":
      return call.status < 400 ? (
        <p>
          The page posts the two tokens to its BFF, which verifies both signatures, the nonce, both
          audiences and the subject, then starts the session with an HttpOnly cookie.
        </p>
      ) : (
        <p>The BFF rejected the tokens. The response&rsquo;s <code>error</code> names the check that failed.</p>
      );
    case "authorize":
      return (
        <p>
          A call to PingOne&rsquo;s <code>/as/authorize</code>. The widget integration never needs one; see
          pi.flow below.
        </p>
      );
    default:
      return null;
  }
}

function CallCard({ n, call }) {
  const ok = call.status < 400;
  return (
    <li className="dvl-call">
      <h4 className="dvl-call-title">
        Call {n}: <code>{callTitle(call)}</code>
      </h4>
      <p>
        <Status ok={ok}>HTTP {call.status}</Status>
        {callKind(call) === "final" && call.success === true && (
          <>
            {" "}
            <Status ok>success, tokens returned</Status>
          </>
        )}
      </p>
      <CallRole call={call} />
    </li>
  );
}

export default function CallInspector({ calls = [] }) {
  if (!calls.length) {
    return <p className="dvl-calls-empty">No calls yet. The first appears as soon as the widget starts.</p>;
  }
  return (
    <ol className="dvl-calls">
      {calls.map((c, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <CallCard key={i} n={i + 1} call={c} />
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/CallInspector.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/davinci/CallInspector.jsx demo_api_ui/src/components/davinci/__tests__/CallInspector.test.jsx
git commit -m "feat(davinci-widget): Call Inspector cards for each widget API call"
```

---

### Task 3: Lesson sections (`components/davinci/WidgetLessonSections.jsx`)

**Files:**
- Create: `demo_api_ui/src/components/davinci/WidgetLessonSections.jsx`
- Test: `demo_api_ui/src/components/davinci/__tests__/WidgetLessonSections.test.jsx`

**Interfaces:**
- Consumes: the `call` shape (Task 1) for the pi.flow "On this run" line.
- Produces: `WIDGET_LESSON_SECTIONS: Array<{ id, label }>` (all twelve, `try-it-live` first); `FLOW_SOURCE: string` (Mermaid); `default WidgetLessonSections({ calls = [] })` rendering sections 2–12.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/davinci/__tests__/WidgetLessonSections.test.jsx
// Pinned: sections match the shared nav order, the diagram parses with the REAL
// Mermaid parser, the API calls are the captured widget contract, pi.flow is
// taught as the contrast, and no secret value can render.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

import WidgetLessonSections, { FLOW_SOURCE, WIDGET_LESSON_SECTIONS } from "../WidgetLessonSections";

describe("WIDGET_LESSON_SECTIONS", () => {
  it("uses the shared order with the widget's two sections before security", () => {
    expect(WIDGET_LESSON_SECTIONS.map((s) => s.id)).toEqual([
      "try-it-live", "overview", "how-its-wired", "pi-flow", "how-it-works", "api-calls",
      "the-flow", "the-final-node", "tokens-to-session", "security", "troubleshooting", "in-this-repo",
    ]);
  });
});

describe("WidgetLessonSections", () => {
  it("renders a section for every nav entry after Try It Live, in nav order", () => {
    const { container } = render(<WidgetLessonSections />);
    const ids = [...container.querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(WIDGET_LESSON_SECTIONS.slice(1).map((s) => s.id));
  });

  it("names the wiring a developer must configure, including which login policy runs", () => {
    const text = render(<WidgetLessonSections />).container.querySelector("#how-its-wired").textContent;
    expect(text).toContain("X-SK-API-KEY");
    expect(text).toContain("PingOne SSO");
    expect(text).toContain("Return Success Response (Widget Flows)");
    expect(text).toContain("No PingOne sign-on policy");
  });

  it("shows the captured wire contract, one copyable block per call", () => {
    const { container } = render(<WidgetLessonSections />);
    const api = container.querySelector("#api-calls");
    expect(api.textContent).toContain("/davinci/policy/");
    expect(api.textContent).toContain("/start");
    expect(api.textContent).toContain('"eventName": "continue"');
    expect(api.textContent).toContain('"capabilityName": "returnSuccessResponseWidget"');
    expect(api.textContent).toContain("/api/davinci-login/widget-session");
    expect(api.querySelectorAll(".lesson-code-copy").length).toBeGreaterThanOrEqual(6);
  });

  it("teaches pi.flow as the contrast and links to the SDK lesson that uses it", () => {
    const { container } = render(<WidgetLessonSections />);
    const piFlow = container.querySelector("#pi-flow");
    expect(piFlow.textContent).toContain("response_mode=pi.flow");
    expect(piFlow.textContent).toContain("never calls /as/authorize");
    expect(piFlow.querySelector('a[href="/davinci-sdk-login"]')).not.toBeNull();
  });

  it("reports this run's calls in pi.flow only once there are some", () => {
    const empty = render(<WidgetLessonSections calls={[]} />).container;
    expect(empty.querySelector("#pi-flow .lesson-run")).toBeNull();

    const calls = [{ method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/policy/p/start", status: 200 }];
    const run = render(<WidgetLessonSections calls={calls} />).container.querySelector("#pi-flow .lesson-run");
    expect(run.querySelector(".lesson-ok").textContent).toContain("0 of 1");
  });

  it("gives copyable integration, SDK-token and session code", () => {
    const code = [...render(<WidgetLessonSections />).container.querySelectorAll("pre code")]
      .map((c) => c.textContent).join("\n");
    expect(code).toContain("davinci.skRenderScreen");
    expect(code).toContain("includeHttpCredentials: true");
    expect(code).toContain("/sdktoken");
    expect(code).toContain("verifyExchangedToken");
  });
});

describe("FLOW_SOURCE is valid Mermaid", () => {
  it("parses", async () => {
    const { default: realMermaid } = await vi.importActual("mermaid");
    await expect(realMermaid.parse(FLOW_SOURCE)).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/WidgetLessonSections.test.jsx`
Expected: FAIL — `Failed to resolve import "../WidgetLessonSections"`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// demo_api_ui/src/components/davinci/WidgetLessonSections.jsx
// The lesson on /davinci-login-guide, below "Try It Live": how the DaVinci widget
// (davinci.js) runs a PingOne DaVinci flow inside your page, and how its result
// becomes a session.
//
// Every claim is backed by one of: a widget run captured on the wire on
// 2026-09-13, the live PingOne/DaVinci configuration of this demo, Ping's widget
// and PingOne Authentication connector docs, or this repo's code. Values that
// would identify a user or a session are shown as "…".
//
// Section ids and order are shared with the Orchestration SDK lesson on
// /davinci-sdk-login; the-final-node and tokens-to-session are widget-specific.
import { CodeBlock, MermaidFigure, OnThisRun, Section, Status, TableBlock } from "../lesson";

export const WIDGET_LESSON_SECTIONS = [
  { id: "try-it-live", label: "Try It Live" },
  { id: "overview", label: "Overview" },
  { id: "how-its-wired", label: "How It's Wired" },
  { id: "pi-flow", label: "pi.flow" },
  { id: "how-it-works", label: "How It Works" },
  { id: "api-calls", label: "API Calls" },
  { id: "the-flow", label: "The Flow" },
  { id: "the-final-node", label: "The Final Node" },
  { id: "tokens-to-session", label: "Tokens to Session" },
  { id: "security", label: "Security" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "in-this-repo", label: "In This Repo" },
];

const CONTRAST = [
  [
    "Redirect (hosted pages)",
    "PingOne's hosted pages, after a 302 from /as/authorize",
    "A code on your redirect_uri",
  ],
  [
    "DaVinci widget (this page)",
    "DaVinci's own HTML, drawn by davinci.js inside your container",
    "Whatever the flow's final node returns to successCallback — here id_token and access_token",
  ],
  [
    "Orchestration SDK + pi.flow",
    "Your UI, drawn from collectors",
    "authorizeResponse.code inside the final JSON (see /davinci-sdk-login)",
  ],
];

const WIRING = [
  [
    "DaVinci application and its API key",
    "DaVinci › Applications › General",
    "Your BFF mints the widget's SDK token with it (X-SK-API-KEY). A server-side secret — never in the browser.",
  ],
  [
    "Flow policy (here a759d4c3 \"AI DEMO\", latest version)",
    "DaVinci › Applications › Flow Policy",
    "Chosen by policyId in the SDK-token request. A widget policy has no trigger: it is not a PingOne flow policy and is not assigned to any PingOne application.",
  ],
  [
    "Flow Input Schema: nonce, username",
    "Flow › Input Schema",
    "The SDK-token request's parameters become {{global.parameters.*}} inside the flow. DaVinci rejects any parameter the schema does not declare.",
  ],
  [
    "PingOne SSO connection",
    "DaVinci › Connections",
    "A worker client (client id, secret, environment, region). The flow's Sign On nodes use it to look up the user and check the password in PingOne.",
  ],
  [
    "PingOne Authentication connection",
    "DaVinci › Connections",
    "Provides Return Success Response (Widget Flows), the node that creates the PingOne session and returns OIDC tokens to the widget.",
  ],
  [
    "That node's settings",
    "Flow › final node",
    "Application id (the OIDC app the tokens are issued to), Reduced Scopes (openid profile email read write ai:agent:read — they decide the access token's audience), and an idTokenClaims entry nonce = {{global.parameters.nonce}} for the BFF's replay check.",
  ],
  [
    "OIDC application's resource grant",
    "PingOne › Applications › Resources",
    "Grants the Demo API scopes, so the access token's aud is enduser.ping.demo — the audience this BFF accepts.",
  ],
  [
    "CORS allowed origin",
    "PingOne › Applications › Configuration",
    "davinci.js calls auth.pingone.com from your page with credentials. Ping's docs put the origin on the PingOne DaVinci Connection app or any app in the environment.",
  ],
];

const BFF_CONFIG = `# demo_api_server — read by config/davinci.js
PINGONE_DAVINCI_LOGIN_COMPANY_ID=<PingOne environment id>
PINGONE_DAVINCI_LOGIN_POLICY_ID_V1=<DaVinci flow policy id>
# PINGONE_DAVINCI_API_KEY lives in the vault, never in .env or the bundle`;

const INTEGRATION = `<div class="dvWidget"></div>
<script src="https://assets.pingone.com/davinci/latest/davinci.js"></script>
<script>
  (async () => {
    // Your BFF mints the SDK token; the API key never reaches the browser.
    const cfg = await (await fetch("/api/davinci-login/sdk-token", { method: "POST" })).json();

    davinci.skRenderScreen(document.querySelector(".dvWidget"), {
      config: {
        method: "runFlow",
        apiRoot: cfg.apiRoot,            // https://auth.pingone.com/
        accessToken: cfg.accessToken,    // the DaVinci SDK token
        companyId: cfg.companyId,        // the PingOne environment id
        policyId: cfg.policyId,          // the DaVinci flow policy
        includeHttpCredentials: true,    // send auth.pingone.com cookies (interactionId)
      },
      useModal: false,
      successCallback: async (response) => {
        // The final node returned OIDC tokens. Let the server verify them.
        await fetch("/api/davinci-login/widget-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: response.id_token, accessToken: response.access_token }),
        });
      },
      errorCallback: (err) => console.error(err),
    });
  })();
</script>`;

const SDK_TOKEN_CALL = `// BFF → DaVinci: mint one SDK token for one widget run
POST https://orchestrate-api.pingone.com/v1/company/<companyId>/sdktoken
X-SK-API-KEY: <DaVinci application API key>
Content-Type: application/json

{
  "policyId": "<flow policy id>",
  "parameters": { "nonce": "…" }   // plus "username" when you pre-fill it
}

// 200
{ "access_token": "eyJ…" }         // the SDK token — not a PingOne access token`;

const PAGE_CONFIG_CALL = `// Page → BFF
POST /api/davinci-login/sdk-token

// 200 — public config only; neither the API key nor the nonce is here
{
  "accessToken": "eyJ…",
  "companyId": "<environment id>",
  "policyId": "<flow policy id>",
  "flowVersion": "v1",
  "apiRoot": "https://auth.pingone.com/"
}`;

const START_CALL = `// davinci.js → DaVinci: start the flow policy
POST https://auth.pingone.com/<envId>/davinci/policy/<policyId>/start
Authorization: Bearer <SDK token>
(no body — the parameters ride inside the SDK token)

// 200, Set-Cookie: interactionId
{
  "interactionId": "…",
  "flowId": "<flow id>",
  "connectionId": "<HTTP connection id>",
  "capabilityName": "customHTMLTemplate",
  "screen": { "name": "…", "properties": { "formFieldsList": { … }, "button": { … } } }
}`;

const SCREEN_CALL = `// davinci.js → DaVinci: submit a screen (Sign On, then Welcome)
POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate
interactionid: …
interactiontoken: …

{
  "id": "…",
  "eventName": "continue",
  "interactionId": "…",
  "nextEvent": { "eventName": "continue", "eventType": "post" },
  "parameters": {
    "buttonType": "form-submit",
    "buttonValue": "SIGNON",
    "username": "…",
    "password": "…"
  }
}

// 200 — the next screen, same shape as the start response.
// After the Create Session node, the response also sets ST and ST-NO-SS.`;

const FINAL_CALL = `// davinci.js → DaVinci: the last submit (Success screen's Continue)
POST https://auth.pingone.com/<envId>/davinci/connections/<connectionId>/capabilities/customHTMLTemplate

// 200 — from the flow's final node, handed to successCallback
{
  "success": true,
  "capabilityName": "returnSuccessResponseWidget",
  "connectorId": "pingOneAuthenticationConnector",
  "id_token": "eyJ…",              // aud = the node's application id; nonce claim
  "access_token": "eyJ…",          // aud = enduser.ping.demo
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email write read ai:agent:read",
  "sessionToken": "…",             // opaque DaVinci session id
  "sessionTokenMaxAge": 2591999
}`;

const SESSION_CALL = `// Page → BFF: turn the tokens into a session
POST /api/davinci-login/widget-session
Content-Type: application/json

{ "idToken": "eyJ…", "accessToken": "eyJ…" }

// 200, Set-Cookie: connect.sid (HttpOnly)
{ "ok": true }

// 401 { "error": "nonce_missing" | "token_unverified" | "nonce_mismatch"
//                | "audience_mismatch" | "subject_mismatch" }
// 404 { "error": "user_not_found" }`;

const SESSION_CODE = `// routes/davinciLogin.js — POST /widget-session (abridged)
const expectedNonce = req.session.davinciLoginNonce;   // armed by /sdk-token
delete req.session.davinciLoginNonce;                  // one use, before any check

const [id, access] = await Promise.all([
  tokenVerificationService.verifyExchangedToken(idToken),
  tokenVerificationService.verifyExchangedToken(accessToken),
]);
// The verifier fails open and can fall back to introspection, whose claims
// carry no nonce or audience — so only a JWKS-verified signature counts.
const jwksVerified = (r) => r.verified === true && r.fallbackMethod === "jwks";
if (!jwksVerified(id) || !jwksVerified(access)) return reject("token_unverified");

if (id.claims.nonce !== expectedNonce) return reject("nonce_mismatch");
if (![].concat(id.claims.aud).includes(oauthService.config.clientId)) return reject("audience_mismatch");
if (bffAudience && ![].concat(access.claims.aud).includes(bffAudience)) return reject("audience_mismatch");
if (id.claims.sub !== access.claims.sub) return reject("subject_mismatch");

// Existing demo users only, then a fresh session (no fixation).
req.session.regenerate(() => {
  req.session.oauthTokens = { accessToken, idToken, refreshToken: null, expiresAt: access.claims.exp * 1000 };
  req.session.user = user;
  res.json({ ok: true });
});`;

export const FLOW_SOURCE = `sequenceDiagram
  autonumber
  participant Page as This page
  participant BFF as BFF
  participant API as DaVinci API
  participant W as davinci.js
  participant DV as DaVinci flow
  participant P1 as PingOne
  Page->>BFF: POST /api/davinci-login/sdk-token
  BFF->>BFF: arm a one-time nonce in the session
  BFF->>API: POST /company/companyId/sdktoken with X-SK-API-KEY
  API-->>BFF: SDK token
  BFF-->>Page: accessToken, companyId, policyId, apiRoot
  Page->>W: davinci.skRenderScreen(container, props)
  W->>DV: POST /davinci/policy/policyId/start with Bearer SDK token
  DV-->>W: first screen as JSON, Set-Cookie interactionId
  loop each screen
    W->>DV: POST /capabilities/customHTMLTemplate with eventName continue
    DV->>P1: PingOne SSO looks up the user and checks the password
    DV-->>W: next screen as JSON
  end
  DV->>P1: PingOne Authentication creates the session and issues tokens
  DV-->>W: success, id_token with nonce, access_token
  W-->>Page: successCallback(response)
  Page->>BFF: POST /api/davinci-login/widget-session
  BFF->>P1: GET /as/jwks and verify both signatures
  BFF-->>Page: ok and an HttpOnly session cookie`;

const FINAL_NODES = [
  [
    "HTTP connector — Send Success JSON Response",
    "No PingOne session and no tokens: only what you put in the JSON",
    "Nothing a server can verify on its own; you must build the session some other way",
  ],
  [
    "PingOne Authentication — Return Success Response (Widget Flows)",
    "Creates the PingOne session and returns id_token, access_token and a sessionToken",
    "Signed OIDC tokens the BFF verifies against PingOne's JWKS — what this page uses",
  ],
];

const TROUBLE = [
  ["Browser console: CORS error on auth.pingone.com", "The page's origin is not an allowed origin on any PingOne app in the environment", "Add it (Ping's docs: the PingOne DaVinci Connection app)"],
  ["431 Request Header Fields Too Large", "davinci.js forwards every cookie the origin has", "Set originCookies to the cookie names your flow needs"],
  ["/sdk-token 503 davinci_not_configured", "Missing company id, policy id, or the vaulted API key", "Set the value the error names"],
  ["\"data has additional properties\" from DaVinci", "A parameter the flow's Input Schema does not declare", "Declare it, or stop sending it"],
  ["The widget never starts the flow", "policyId names a PingOne flow policy (trigger AUTHENTICATION), which only /as/authorize runs", "Use a widget flow policy (no trigger) for the widget; keep PingOne flow policies for redirect or the SDK"],
  ["Widget shows no tokens / 401 token_unverified", "The final node is an HTTP success response, or a signature did not verify", "End the flow with Return Success Response (Widget Flows)"],
  ["401 nonce_mismatch", "The final node lost its nonce idTokenClaim, or a stale widget run", "Restart the sign-in; check the node's idTokenClaims"],
  ["401 audience_mismatch", "The node issues tokens for a different app, or without the Demo API scopes", "Point the node at the BFF's client and request the resource scopes"],
  ["404 user_not_found", "The PingOne user has no demo account", "Sign in as an existing demo user"],
];

const FILES = [
  ["demo_api_ui/src/pages/DavinciLoginGuidePage.jsx", "This page: LessonLayout, Try It Live grid, run summary modal"],
  ["demo_api_ui/src/pages/DavinciLoginWidget.jsx", "Mints config, installs the call trace, runs skRenderScreen, posts the tokens"],
  ["demo_api_ui/src/lib/davinciWidgetClient.js", "davinci.js loader, POST /sdk-token, POST /widget-session, GET /api/auth/me"],
  ["demo_api_ui/src/lib/davinciWidgetTrace.js", "Records the widget's calls (addresses and status only) for the Call Inspector"],
  ["demo_api_ui/src/components/davinci/CallInspector.jsx", "One card per call, live beside the widget"],
  ["demo_api_ui/src/components/davinci/WidgetRunSummary.jsx", "The What just happened modal"],
  ["demo_api_ui/src/components/davinci/WidgetLessonSections.jsx", "These sections"],
  ["demo_api_server/routes/davinciLogin.js", "POST /sdk-token (SDK token + nonce) and POST /widget-session (verification + session)"],
  ["demo_api_server/config/davinci.js", "Company id, policy ids, API key lookup"],
];

export default function WidgetLessonSections({ calls = [] }) {
  const authorizeCalls = calls.filter((c) => c.path?.endsWith("/as/authorize")).length;
  return (
    <>
      <Section id="overview" title="Overview">
        <p>
          The DaVinci widget is Ping&rsquo;s hosted <code>davinci.js</code>. You give it a container, an SDK
          token and a flow policy id; it runs the DaVinci flow and draws the flow&rsquo;s own screens inside
          your page. Your code never renders a field. When the flow finishes, the widget calls your{" "}
          <code>successCallback</code> with whatever the flow&rsquo;s final node returned.
        </p>
        <p>The three ways to put a DaVinci sign-in in front of a user:</p>
        <TableBlock headers={["Integration", "Who draws the screens", "What your code receives"]} rows={CONTRAST} />
      </Section>

      <Section id="how-its-wired" title="How It's Wired">
        <p>
          The widget does not use a PingOne application&rsquo;s authorize endpoint at all. Your BFF picks a
          DaVinci flow policy by id and mints an SDK token for it; the flow does the sign-in against PingOne
          through its connections. Everything below has to be in place.
        </p>
        <TableBlock headers={["Setting", "Where", "Why it matters"]} rows={WIRING} />
        <p>
          <strong>Which login policy runs?</strong> No PingOne sign-on policy runs. The DaVinci flow is the
          login policy: the widget runs the flow policy you name directly. That is the difference from the
          Orchestration SDK, whose PingOne application has a flow policy assignment to a PingOne flow policy
          (trigger <code>AUTHENTICATION</code>), which is what makes <code>/as/authorize</code> run a flow.
        </p>
        <CodeBlock title="BFF configuration" code={BFF_CONFIG} language="bash" />
      </Section>

      <Section id="pi-flow" title="pi.flow">
        <p>
          <code>response_mode=pi.flow</code> is a parameter of PingOne&rsquo;s{" "}
          <code>GET /as/authorize</code>. A normal authorize request answers with a <strong>302</strong> to
          PingOne&rsquo;s hosted pages; with pi.flow, PingOne answers the same request with{" "}
          <strong>200 and JSON</strong> describing the current flow step, and delivers the authorization code
          inside the final JSON. That is what lets the Orchestration SDK draw the sign-in in your own UI.
        </p>
        <p>
          The widget never calls /as/authorize, so pi.flow never appears. It reaches the same kind of JSON
          steps through DaVinci&rsquo;s own API instead: <code>/davinci/policy/&lt;policyId&gt;/start</code>{" "}
          and <code>/capabilities/&lt;name&gt;</code> posts, authenticated by the SDK token rather than an OAuth
          client. Both keep the user on your page; they differ in who draws the screens and in what comes back.
        </p>
        <p>
          To see pi.flow on the wire, run the <a href="/davinci-sdk-login">Orchestration SDK lesson</a>: its
          Step Inspector shows <code>response_mode=pi.flow</code> read off the real authorize request.
        </p>
        {calls.length > 0 && (
          <OnThisRun>
            <p>
              <Status ok={authorizeCalls === 0}>
                {authorizeCalls} of {calls.length} calls this page recorded went to /as/authorize
              </Status>
            </p>
          </OnThisRun>
        )}
      </Section>

      <Section id="how-it-works" title="How It Works">
        <ol className="lesson-list">
          <li>The page asks its BFF for widget config: <code>POST /api/davinci-login/sdk-token</code>.</li>
          <li>
            The BFF arms a one-time nonce in the session, then calls DaVinci&rsquo;s{" "}
            <code>/sdktoken</code> with its API key, passing the nonce as a flow parameter. It returns the SDK
            token and public config — never the key or the nonce.
          </li>
          <li>
            The page calls <code>davinci.skRenderScreen</code>. davinci.js posts{" "}
            <code>/davinci/policy/&lt;policyId&gt;/start</code> with the SDK token and draws the first screen.
          </li>
          <li>
            Each button posts the screen to <code>/capabilities/customHTMLTemplate</code>; DaVinci runs the flow
            to the next screen. The Sign On nodes check the password through the PingOne SSO connection.
          </li>
          <li>
            The flow creates a PingOne session and ends at Return Success Response (Widget Flows), which returns{" "}
            <code>id_token</code> (carrying the nonce) and <code>access_token</code>.
          </li>
          <li>davinci.js calls <code>successCallback</code> with that response.</li>
          <li>
            The page posts both tokens to <code>POST /api/davinci-login/widget-session</code>; the BFF verifies
            them and starts the session. The page never navigates.
          </li>
        </ol>
        <CodeBlock title="The whole client integration" code={INTEGRATION} language="html" />
      </Section>

      <Section id="api-calls" title="API Calls">
        <p>
          Every call on a real run, captured on the wire and abridged. Values that identify a user or a session
          are shown as <code>…</code>.
        </p>
        <CodeBlock title="1. Page → BFF: widget config" code={PAGE_CONFIG_CALL} language="http" />
        <CodeBlock title="2. BFF → DaVinci: mint the SDK token" code={SDK_TOKEN_CALL} language="http" />
        <CodeBlock title="3. davinci.js → DaVinci: start the flow" code={START_CALL} language="http" />
        <CodeBlock title="4. davinci.js → DaVinci: submit a screen" code={SCREEN_CALL} language="http" />
        <CodeBlock title="5. davinci.js → DaVinci: the final node answers" code={FINAL_CALL} language="http" />
        <CodeBlock title="6. Page → BFF: tokens to session" code={SESSION_CALL} language="http" />
      </Section>

      <Section id="the-flow" title="The Flow">
        <MermaidFigure source={FLOW_SOURCE} label="DaVinci widget sign-in sequence" />
      </Section>

      <Section id="the-final-node" title="The Final Node">
        <p>
          What the widget hands your <code>successCallback</code> is decided entirely by the node the flow ends
          on. The widget does not return an authorization code.
        </p>
        <TableBlock headers={["Final node", "What it does", "What your code gets"]} rows={FINAL_NODES} />
        <p>
          This flow ends with PingOne Authentication&rsquo;s Return Success Response (Widget Flows), configured
          with the application id the tokens are issued to, the scopes{" "}
          <code>openid profile email read write ai:agent:read</code>, and an <code>idTokenClaims</code> entry{" "}
          <code>nonce = {"{{global.parameters.nonce}}"}</code>. Change any of the three and every sign-in fails
          the BFF&rsquo;s checks.
        </p>
        <p>
          <strong>Why not redirect to /authorize after the widget?</strong> It was tried here and measured not to
          work. PingOne&rsquo;s session cookie (<code>ST</code>) is set during the widget&rsquo;s cross-site calls
          and never reaches a top-level <code>/as/authorize</code>, so PingOne shows its hosted sign-on page
          instead of a code. Safari and Firefox block such cookies by default. Use the tokens the node returns.
        </p>
      </Section>

      <Section id="tokens-to-session" title="Tokens to Session">
        <p>The tokens crossed the browser, so the BFF trusts nothing about them until it has checked:</p>
        <ol className="lesson-list">
          <li><strong>The nonce is armed and single-use.</strong> Read and deleted before any other check.</li>
          <li>
            <strong>Both signatures verify against PingOne&rsquo;s JWKS.</strong> Not introspection alone, and not
            a fail-open result.
          </li>
          <li><strong>The ID token&rsquo;s nonce</strong> equals the armed one.</li>
          <li><strong>The ID token&rsquo;s audience</strong> is this app&rsquo;s client id.</li>
          <li><strong>The access token&rsquo;s audience</strong> includes this API&rsquo;s resource.</li>
          <li><strong>Both tokens name the same subject.</strong></li>
          <li>
            <strong>Existing demo users only</strong>, then the session is regenerated and the tokens are stored
            server-side behind an HttpOnly cookie.
          </li>
        </ol>
        <CodeBlock title="POST /api/davinci-login/widget-session" code={SESSION_CODE} language="js" />
        <p>
          The node returns no refresh token, so the session lasts as long as the access token (3600 seconds on
          this run).
        </p>
      </Section>

      <Section id="security" title="Security">
        <ul className="lesson-list">
          <li>The DaVinci API key stays on the server; the browser only ever holds a short-lived SDK token.</li>
          <li>The nonce never reaches the browser — it travels inside the SDK token and comes back in the ID token.</li>
          <li>Tokens are verified, never trusted: JWKS signatures, nonce, both audiences and the subject.</li>
          <li>The session is regenerated before tokens are stored, and tokens live server-side only.</li>
          <li>Only existing demo users sign in; nothing is auto-created from a DaVinci login.</li>
        </ul>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <TableBlock headers={["Symptom", "Cause", "Fix"]} rows={TROUBLE} />
      </Section>

      <Section id="in-this-repo" title="In This Repo">
        <TableBlock headers={["File", "Purpose"]} rows={FILES} />
      </Section>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/WidgetLessonSections.test.jsx`
Expected: PASS (8 tests). If "parses" fails, fix the offending FLOW_SOURCE line (Mermaid rejects `;` and `#` in messages).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/davinci/WidgetLessonSections.jsx demo_api_ui/src/components/davinci/__tests__/WidgetLessonSections.test.jsx
git commit -m "feat(davinci-widget): developer lesson sections for the widget integration"
```

---

### Task 4: Run summary (`components/davinci/WidgetRunSummary.jsx`)

**Files:**
- Create: `demo_api_ui/src/components/davinci/WidgetRunSummary.jsx`
- Test: `demo_api_ui/src/components/davinci/__tests__/WidgetRunSummary.test.jsx`

**Interfaces:**
- Consumes: `summarizeWidgetTrace` (Task 1), `callTitle` (Task 2).
- Produces: `default WidgetRunSummary({ username = null, calls = [], onNavigate })`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/davinci/__tests__/WidgetRunSummary.test.jsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import WidgetRunSummary from "../WidgetRunSummary";

const call = (path, extra = {}) => ({
  method: "POST", host: "auth.pingone.com", path, status: 200, capabilityName: null, connectorId: null, success: null, ...extra,
});
const RUN = [
  call("/api/davinci-login/sdk-token"),
  call("/env-1/davinci/policy/p/start", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c/capabilities/customHTMLTemplate", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c/capabilities/customHTMLTemplate", { capabilityName: "returnSuccessResponseWidget", success: true }),
  call("/api/davinci-login/widget-session"),
];

describe("WidgetRunSummary", () => {
  it("says who signed in and that the page never left", () => {
    const { container } = render(<WidgetRunSummary username="demouser" calls={RUN} />);
    expect(container.querySelector(".lesson-lede").textContent).toContain("demouser");
    expect(container.textContent).toContain("without an /authorize redirect");
  });

  it("reports the run from the recorded calls", () => {
    const { container } = render(<WidgetRunSummary calls={RUN} />);
    const run = container.querySelector(".lesson-run").textContent;
    expect(run).toContain("2 screen submits");
    expect(run).toContain("returnSuccessResponseWidget");
    expect(container.querySelectorAll(".lesson-run ol li")).toHaveLength(5);
  });

  it("warns when the final node returned no tokens", () => {
    const noTokens = RUN.map((c) => (c.capabilityName === "returnSuccessResponseWidget" ? { ...c, success: null } : c));
    const { container } = render(<WidgetRunSummary calls={noTokens} />);
    expect(container.querySelector(".lesson-warn").textContent).toContain("no tokens");
  });

  it("links into the lesson sections through onNavigate", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(<WidgetRunSummary calls={RUN} onNavigate={onNavigate} />);
    fireEvent.click(getByText("API Calls"));
    expect(onNavigate).toHaveBeenCalledWith("api-calls");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/WidgetRunSummary.test.jsx`
Expected: FAIL — `Failed to resolve import "../WidgetRunSummary"`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// demo_api_ui/src/components/davinci/WidgetRunSummary.jsx
// "What just happened": the short run summary shown after a widget sign-in on
// /davinci-login-guide. The teaching lives in the page's lesson sections; this
// says what happened on THIS run and links into them. Built only from the calls
// lib/davinciWidgetTrace.js recorded (addresses and status, never values).
import { useMemo } from "react";
import { summarizeWidgetTrace } from "../../lib/davinciWidgetTrace";
import { Lede, LessonFoot, OnThisRun, Status } from "../lesson";
import { callTitle } from "./CallInspector";

const READ_NEXT = [
  ["Every call you just made, request and response", "api-calls", "API Calls"],
  ["Why the flow's last node decides what the widget returns", "the-final-node", "The Final Node"],
  ["What the BFF checked before signing you in", "tokens-to-session", "Tokens to Session"],
  ["Why this never used pi.flow", "pi-flow", "pi.flow"],
];

export default function WidgetRunSummary({ username = null, calls = [], onNavigate }) {
  const run = useMemo(() => summarizeWidgetTrace(calls), [calls]);

  const link = (id, label) => (
    <a
      href={`#${id}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(id);
      }}
    >
      {label}
    </a>
  );

  return (
    <div>
      <Lede>
        {username ? (
          <>
            You&rsquo;re signed in as <strong>{username}</strong> and still on this page.
          </>
        ) : (
          "You're signed in and still on this page."
        )}{" "}
        Here is what the DaVinci widget did on this run. The lesson on this page explains each part.
      </Lede>

      <OnThisRun>
        <ul className="lesson-list">
          <li>
            <Status ok>Signed in without an /authorize redirect: this page never navigated</Status>
          </li>
          <li>
            The flow started{run.started ? "" : " (start call not captured)"}, then {run.capabilityPosts} screen
            submits.
          </li>
          <li>
            Final node: <code>{run.finalCapability || "not captured"}</code>{" "}
            <Status ok={run.tokensReturned}>
              {run.tokensReturned ? "returned id_token and access_token" : "no tokens were returned"}
            </Status>
          </li>
          <li>
            Session:{" "}
            {run.session ? (
              <Status ok={run.session.status < 400}>POST /widget-session answered HTTP {run.session.status}</Status>
            ) : (
              "not captured"
            )}
          </li>
        </ul>
        {run.calls.length > 0 && (
          <>
            <p className="lesson-run-title">The calls, in order</p>
            <ol className="lesson-list">
              {run.calls.map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <code>{callTitle(c)}</code> — HTTP {c.status}
                  {c.capabilityName ? (
                    <>
                      , <code>{c.capabilityName}</code>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </OnThisRun>

      <p className="lesson-run-title">Read next</p>
      <ul className="lesson-list">
        {READ_NEXT.map(([what, id, label]) => (
          <li key={id}>
            {what}: {link(id, label)}
          </li>
        ))}
      </ul>

      <LessonFoot>
        More: the <a href="/davinci-sdk-login">Orchestration SDK lesson</a>, and Ping&rsquo;s{" "}
        <a
          href="https://docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_launching_a_flow_with_the_widget.html"
          target="_blank"
          rel="noreferrer"
        >
          widget documentation
        </a>
        .
      </LessonFoot>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/components/davinci/__tests__/WidgetRunSummary.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/davinci/WidgetRunSummary.jsx demo_api_ui/src/components/davinci/__tests__/WidgetRunSummary.test.jsx
git commit -m "feat(davinci-widget): What just happened run summary"
```

---

### Task 5: Widget reports sign-in and records its calls

**Files:**
- Modify: `demo_api_ui/src/lib/davinciWidgetClient.js` (add `fetchSignedInUser`)
- Modify: `demo_api_ui/src/pages/DavinciLoginWidget.jsx`
- Test: `demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js`, `demo_api_ui/src/pages/__tests__/DavinciLoginWidget.test.jsx`

**Interfaces:**
- Consumes: `installWidgetTrace(onCall)` (Task 1).
- Produces: `fetchSignedInUser() => Promise<string|null>` (never throws); `DavinciLoginWidget({ onCall, onStart, onSignedIn })` — calls `onStart()` at each run start, `onCall(call)` per recorded call, `onSignedIn({ username })` after `/widget-session` succeeds. No navigation.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js` (and add `fetchSignedInUser` to its import line):

```js
describe("fetchSignedInUser", () => {
  test("returns the session's username from /api/auth/me", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ user: { username: "demouser" } }) }));

    await expect(fetchSignedInUser()).resolves.toBe("demouser");
    expect(global.fetch.mock.calls[0][0]).toBe("/api/auth/me");
  });

  test("returns null instead of throwing when the lookup fails", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));
    await expect(fetchSignedInUser()).resolves.toBeNull();

    global.fetch = vi.fn(() => Promise.reject(new Error("offline")));
    await expect(fetchSignedInUser()).resolves.toBeNull();
  });
});
```

In `demo_api_ui/src/pages/__tests__/DavinciLoginWidget.test.jsx`, extend the client mock and mock the trace:

```jsx
vi.mock("../../lib/davinciWidgetClient", () => ({
  loadWidget: vi.fn(),
  fetchWidgetConfig: vi.fn(),
  postWidgetSession: vi.fn(),
  fetchSignedInUser: vi.fn(),
}));
vi.mock("../../lib/davinciWidgetTrace", () => ({ installWidgetTrace: vi.fn() }));

import { loadWidget, fetchWidgetConfig, postWidgetSession, fetchSignedInUser } from "../../lib/davinciWidgetClient";
import { installWidgetTrace } from "../../lib/davinciWidgetTrace";
```

Replace the test `"successCallback hands the flow's tokens to the BFF, then loads the confirmation page"` with:

```jsx
  test("successCallback posts the tokens, stays on the page and reports who signed in", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockResolvedValue({ ok: true });
    fetchSignedInUser.mockResolvedValue("demouser");
    const uninstall = vi.fn();
    installWidgetTrace.mockReturnValue(uninstall);
    const onSignedIn = vi.fn();

    render(<DavinciLoginWidget onCall={vi.fn()} onSignedIn={onSignedIn} />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });

    expect(postWidgetSession).toHaveBeenCalledWith({ idToken: "id-1", accessToken: "at-1" });
    expect(onSignedIn).toHaveBeenCalledWith({ username: "demouser" });
    expect(uninstall).toHaveBeenCalled();
    expect(assigned).toEqual([]);
    expect(cookieWrites).toEqual([]);
  });

  test("installs the call trace before it fetches config, so /sdk-token and /start are recorded", async () => {
    const order = [];
    installWidgetTrace.mockImplementation(() => { order.push("trace"); return vi.fn(); });
    fetchWidgetConfig.mockImplementation(async () => { order.push("config"); return CONFIG; });
    loadWidget.mockResolvedValue({ skRenderScreen: vi.fn() });
    const onCall = vi.fn();
    const onStart = vi.fn();

    render(<DavinciLoginWidget onCall={onCall} onStart={onStart} />);

    await waitFor(() => expect(order).toEqual(["trace", "config"]));
    expect(installWidgetTrace).toHaveBeenCalledWith(onCall);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  test("removes the call trace when it unmounts", async () => {
    const uninstall = vi.fn();
    installWidgetTrace.mockReturnValue(uninstall);
    loadWidget.mockResolvedValue({ skRenderScreen: vi.fn() });

    const { unmount } = render(<DavinciLoginWidget onCall={vi.fn()} />);
    await waitFor(() => expect(installWidgetTrace).toHaveBeenCalled());
    unmount();

    expect(uninstall).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/davinciWidgetClient.test.js src/pages/__tests__/DavinciLoginWidget.test.jsx`
Expected: FAIL — `fetchSignedInUser is not a function`, `onSignedIn` not called, `installWidgetTrace` not called.

- [ ] **Step 3: Write minimal implementation**

Append to `demo_api_ui/src/lib/davinciWidgetClient.js`:

```js
// Who the new session belongs to, for the run summary. /widget-session answers
// only { ok: true }, and the lesson must not guess: read the existing
// /api/auth/me. Never throws — a failed lookup only drops the name from the lede.
export async function fetchSignedInUser() {
  try {
    const res = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.user?.username || null;
  } catch {
    return null;
  }
}
```

In `demo_api_ui/src/pages/DavinciLoginWidget.jsx`:

1. Change the imports to:

```jsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSignedInUser,
  fetchWidgetConfig,
  loadWidget,
  postWidgetSession,
} from "../lib/davinciWidgetClient";
import { installWidgetTrace } from "../lib/davinciWidgetTrace";
import "./DavinciLoginPage.css";
```

2. Replace the last paragraph of the header comment (from `// The flow ends with the PingOne Authentication connector's` to the end of the comment) with:

```jsx
// The flow ends with the PingOne Authentication connector's "Return Success
// Response (Widget Flows)", which hands OIDC tokens to successCallback. The page
// posts them to the BFF, which verifies them and signs the user in. The widget
// stays on the page and reports the sign-in through onSignedIn; while it runs,
// installWidgetTrace records each API call (addresses and status only) for the
// lesson's Call Inspector.
```

3. Change the component signature and add the trace ref and cleanup:

```jsx
export default function DavinciLoginWidget({ onCall, onStart, onSignedIn }) {
  const [status, setStatus] = useState("loading"); // loading | flow | signedIn | error
  const [error, setError] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const containerRef = useRef(null);
  // skRenderScreen mutates the container directly. StrictMode double-invokes
  // effects, so without this the flow renders twice into the same node.
  const renderedRef = useRef(false);
  const uninstallTraceRef = useRef(null);

  const stopTrace = useCallback(() => {
    uninstallTraceRef.current?.();
    uninstallTraceRef.current = null;
  }, []);

  useEffect(() => stopTrace, [stopTrace]);
```

4. Replace the body of `start` up to and including `const cfg = await fetchWidgetConfig();` with:

```jsx
  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    onStart?.();
    // Installed before the config fetch so /sdk-token and /start are recorded.
    stopTrace();
    if (onCall) uninstallTraceRef.current = installWidgetTrace(onCall);
    try {
      const cfg = await fetchWidgetConfig();
```

5. Replace `successCallback` and `errorCallback` with:

```jsx
        successCallback: async (response) => {
          try {
            await postWidgetSession({
              idToken: response?.id_token,
              accessToken: response?.access_token,
            });
            const username = await fetchSignedInUser();
            stopTrace();
            setStatus("signedIn");
            onSignedIn?.({ username });
          } catch (err) {
            stopTrace();
            setError(err.message);
            setStatus("error");
          }
        },
        errorCallback: (err) => {
          stopTrace();
          setError(err?.message || "The DaVinci flow could not be completed.");
          setStatus("error");
        },
```

6. In the outer `catch (err)` of `start`, add `stopTrace();` as its first line, and change the dependency array of `start` from `[]` to `[onCall, onStart, onSignedIn, stopTrace]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/davinciWidgetClient.test.js src/pages/__tests__/DavinciLoginWidget.test.jsx`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/lib/davinciWidgetClient.js demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js demo_api_ui/src/pages/DavinciLoginWidget.jsx demo_api_ui/src/pages/__tests__/DavinciLoginWidget.test.jsx
git commit -m "feat(davinci-widget): stay on the page after sign-in and record the widget's calls"
```

---

### Task 6: The guide page on the lesson shell

**Files:**
- Modify (rewrite): `demo_api_ui/src/pages/DavinciLoginGuidePage.jsx`
- Modify (rewrite): `demo_api_ui/src/pages/DavinciLoginGuidePage.css`
- Test: `demo_api_ui/src/pages/__tests__/DavinciLoginGuidePage.test.jsx` (new)

**Interfaces:**
- Consumes: `WidgetLessonSections`, `WIDGET_LESSON_SECTIONS` (Task 3), `CallInspector` (Task 2), `WidgetRunSummary` (Task 4), `DavinciLoginWidget({ onCall, onStart, onSignedIn })` (Task 5), `LessonLayout`, `Section` from `../components/lesson`, `DraggableModal`.
- Produces: the page (default export, unchanged route).

- [ ] **Step 1: Check nothing else uses the old guide classes**

Run: `grep -rn "dlg-" demo_api_ui/src --include=*.jsx --include=*.js --include=*.css | grep -v "DavinciLoginGuidePage"`
Expected: no output. If anything prints, keep those `dlg-*` rules in the CSS rewrite below.

- [ ] **Step 2: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/DavinciLoginGuidePage.test.jsx
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

let widgetProps;
vi.mock("../DavinciLoginWidget", () => ({
  default: (props) => {
    widgetProps = props;
    return <div data-testid="widget" />;
  },
}));

import DavinciLoginGuidePage from "../DavinciLoginGuidePage";
import { WIDGET_LESSON_SECTIONS } from "../../components/davinci/WidgetLessonSections";

describe("DavinciLoginGuidePage", () => {
  it("lays the lesson out with a nav entry and a section for every shared section id", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    const nav = [...container.querySelectorAll('nav[aria-label="Lesson sections"] button')].map((b) => b.textContent);
    expect(nav).toEqual(WIDGET_LESSON_SECTIONS.map((s) => s.label));
    const ids = [...container.querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(WIDGET_LESSON_SECTIONS.map((s) => s.id));
  });

  it("shows each recorded call in the Call Inspector as it happens", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    act(() => {
      widgetProps.onCall({ method: "POST", host: "auth.pingone.com", path: "/e/davinci/policy/p/start", status: 200, capabilityName: "customHTMLTemplate" });
    });
    expect(container.querySelectorAll(".dvl-live-calls .dvl-call")).toHaveLength(1);
  });

  it("opens the run summary after sign-in, and its links close it", () => {
    const { getByText, queryByText } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    expect(getByText("What just happened")).toBeTruthy();

    fireEvent.click(getByText("API Calls", { selector: ".dm-scroll a" }));
    expect(queryByText("Here is what the DaVinci widget did on this run.", { exact: false })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/DavinciLoginGuidePage.test.jsx`
Expected: FAIL — the old page has no `nav[aria-label="Lesson sections"]` and no `.dvl-live-calls`.

- [ ] **Step 4: Rewrite the page**

```jsx
// demo_api_ui/src/pages/DavinciLoginGuidePage.jsx
// /davinci-login-guide — the DaVinci widget lesson. Laid out on the shared lesson
// shell (components/lesson) so it reads as one course with /davinci-sdk-login:
// Try It Live (the widget beside a live Call Inspector), then the lesson
// sections, then a "What just happened" summary after sign-in.
import { useCallback, useState } from "react";
import CallInspector from "../components/davinci/CallInspector";
import WidgetLessonSections, { WIDGET_LESSON_SECTIONS } from "../components/davinci/WidgetLessonSections";
import WidgetRunSummary from "../components/davinci/WidgetRunSummary";
import DraggableModal from "../components/DraggableModal";
import { LessonLayout, Section } from "../components/lesson";
import DavinciLoginWidget from "./DavinciLoginWidget";
import "./DavinciLoginGuidePage.css";

export default function DavinciLoginGuidePage() {
  const [calls, setCalls] = useState([]);
  const [signedIn, setSignedIn] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

  const onStart = useCallback(() => {
    setCalls([]);
    setSignedIn(null);
  }, []);
  const onCall = useCallback((call) => setCalls((prev) => [...prev, call]), []);
  const onSignedIn = useCallback((info) => {
    setSignedIn(info);
    setShowSummary(true);
  }, []);

  // From the summary's links: close it and bring that lesson section into view.
  const goToSection = useCallback((id) => {
    setShowSummary(false);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
  }, []);

  return (
    <LessonLayout
      title="DaVinci Widget"
      subtitle={
        <>
          Ping&rsquo;s hosted davinci.js runs a PingOne DaVinci flow and draws the flow&rsquo;s own screens
          inside this page. Try it live, watch every API call in the Call Inspector, then read how it works.
        </>
      }
      sections={WIDGET_LESSON_SECTIONS}
      storageKey="dvl-lesson-nav-width"
    >
      <Section id="try-it-live" title="Try It Live">
        <p>
          This is a working sign-in. Every screen below is DaVinci&rsquo;s own HTML, drawn by the widget. Each
          call the widget and this page make appears in the Call Inspector as it happens: config from the BFF,
          the flow start, each screen submit, the final node&rsquo;s tokens, and the session.
        </p>

        <div className="dvl-live">
          <div className="dvl-live-app">
            <DavinciLoginWidget onStart={onStart} onCall={onCall} onSignedIn={onSignedIn} />
            {signedIn && (
              <div className="dvl-signed-in">
                <p>
                  {signedIn.username ? (
                    <>
                      Signed in as <strong>{signedIn.username}</strong>.
                    </>
                  ) : (
                    "Signed in."
                  )}
                </p>
                <button type="button" className="dvl-retry" onClick={() => setShowSummary(true)}>
                  What just happened?
                </button>
              </div>
            )}
          </div>

          <div className="dvl-live-calls">
            <h3>Call Inspector</h3>
            <CallInspector calls={calls} />
          </div>
        </div>
      </Section>

      <WidgetLessonSections calls={calls} />

      <DraggableModal
        isOpen={showSummary}
        onClose={() => setShowSummary(false)}
        title="What just happened"
        storageKey="davinci-widget-run-summary"
        defaultWidth={720}
        defaultHeight={620}
      >
        <div className="dm-scroll">
          <WidgetRunSummary username={signedIn?.username} calls={calls} onNavigate={goToSection} />
        </div>
      </DraggableModal>
    </LessonLayout>
  );
}
```

```css
/* demo_api_ui/src/pages/DavinciLoginGuidePage.css
   /davinci-login-guide — only what the shared lesson shell (components/lesson)
   does not provide: the Try It Live grid and the Call Inspector cards. Mirrors
   DavinciSdkLoginPage.css's .dvsdk-live. Every colour is a --th-* token; font
   sizes come from the scale; radii from --radius-*. */

.dvl-live {
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
  margin-top: 1rem;
}

/* Sticky below the app's sticky TopNav, not under it. */
.dvl-live-app {
  position: sticky;
  top: calc(var(--topnav-height, 60px) + 1rem);
  padding: 1.25rem;
  color: var(--th-text);
  background: var(--th-bg-card);
  border: 1px solid var(--th-border);
  border-radius: var(--radius-lg);
}

.dvl-live-calls h3 {
  margin: 0 0 0.75rem;
  font-size: var(--font-size-lg);
  color: var(--th-text);
}

.dvl-signed-in {
  margin-top: 1rem;
  padding-top: 1rem;
  color: var(--th-text-body);
  border-top: 1px solid var(--th-border);
}

.dvl-calls {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dvl-call {
  margin: 0 0 0.75rem;
  padding: 0.75rem 1rem;
  color: var(--th-text-body);
  background: var(--th-bg-card);
  border: 1px solid var(--th-border);
  border-radius: var(--radius-md);
}

.dvl-call-title {
  margin: 0 0 0.35rem;
  font-size: var(--font-size-sm);
  color: var(--th-text);
  overflow-wrap: anywhere;
}

.dvl-call p {
  margin: 0.25rem 0 0;
  font-size: var(--font-size-sm);
}

.dvl-calls-empty {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--th-text-muted);
}

@media (max-width: 900px) {
  .dvl-live {
    grid-template-columns: minmax(0, 1fr);
  }

  .dvl-live-app {
    position: static;
  }
}
```

- [ ] **Step 5: Run the page test and the gates this page triggers**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/DavinciLoginGuidePage.test.jsx themingRatchet dmScrollContract davinciExplainerFollowsAppTheme`
Expected: PASS. If a theming ratchet names a literal in `DavinciLoginGuidePage.css`, replace it with the token it asks for.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/DavinciLoginGuidePage.jsx demo_api_ui/src/pages/DavinciLoginGuidePage.css demo_api_ui/src/pages/__tests__/DavinciLoginGuidePage.test.jsx
git commit -m "feat(davinci-widget): the guide page as a developer lesson on the shared shell"
```

---

### Task 7: Full verification, PR, deploy and live check

**Files:**
- Modify: none in the repo (a scratch probe only).

- [ ] **Step 1: Full UI suite and build**

Run: `cd demo_api_ui && npm run test:unit > /tmp/lesson-unit.txt 2>&1; echo "exit=$?"; grep -E "Test Files|Tests " /tmp/lesson-unit.txt | tail -2`
Expected: `exit=0`. A lone red suite that passes alone (`./node_modules/.bin/vitest run <file>`) is contention, not a regression.

Run: `cd demo_api_ui && npm run build > /tmp/lesson-build.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 2: Emoji allowlist**

Run: `git diff origin/main -- demo_api_ui | grep -nP "^\+.*[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" | grep -vE "✓|⚠️"`
Expected: no output.

- [ ] **Step 3: Push and open the PR**

Write the PR body to the session scratchpad as `pr-body-lesson.md`, following `.github/pull_request_template.md` (Summary / Activation / config / Test plan) and ending with the Claude Code attribution line. Then:

```bash
git push -u origin worktree-davinci-widget-lesson
gh pr create --base main --head worktree-davinci-widget-lesson \
  --title "feat(davinci-widget): /davinci-login-guide as a developer lesson" \
  --body-file /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/31a750c1-643f-4a0d-86be-58f66efa5d58/scratchpad/pr-body-lesson.md
```

- [ ] **Step 4: After merge — deploy and live check**

From the main checkout (not a worktree session): `bash scripts/deploy-live.sh` with no arguments. Verify by content:

```bash
docker exec ai-demo-ui grep -cF "WidgetLessonSections" /app/src/pages/DavinciLoginGuidePage.jsx
```

Expected: `1` or more.

Pin the stack generation, then drive a fresh browser on `https://local.ping-devops.com:4000/davinci-login-guide`: Sign On → Welcome → Success → Continue. Pass when all hold:
- the page URL is still `/davinci-login-guide` and a "What just happened" dialog is open with the username
- the Call Inspector lists `/api/davinci-login/sdk-token`, `/davinci/policy/…/start`, the capability posts ending in `returnSuccessResponseWidget`, and `/api/davinci-login/widget-session` with HTTP 200
- `GET /api/auth/me` returned 200
- no request to `/as/authorize` was made
- the stack generation is unchanged afterwards (otherwise the run is void)
