# Decision Endpoint Auto-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects "PingOne Authorize" mode in the engine settings panel, automatically fetch available decision endpoints and populate a dropdown (multiple) or auto-fill (single), degrading gracefully when credentials aren't saved or the user isn't admin.

**Architecture:** Single-file frontend change in `AuthzTestPage.jsx`. Add three state vars, one `useEffect`, and replace the static Decision Endpoint ID text input with a conditional render block. No backend changes.

**Tech Stack:** React (hooks), existing `apiClient` (axios wrapper), existing CSS classes `authz-input` / `authz-engine-creds-hint`.

## Global Constraints

- Touch only `demo_api_ui/src/components/AuthzTestPage.jsx` — no other files
- No new CSS classes — reuse `authz-input` and `authz-engine-creds-hint`
- `endpointId` (existing state) remains the source of truth for saves — do not rename or replace it
- 422 response from `/api/authorize/decision-endpoints` → fully silent
- 403 response → show hint "Admin required to fetch endpoint list", text input still editable
- 502 / network error → show hint "Could not fetch endpoint list — enter ID manually"
- Auto-select only when `endpointId` is currently empty (don't clobber saved value)

---

### Task 1: Add state and fetch effect

**Files:**
- Modify: `demo_api_ui/src/components/AuthzTestPage.jsx` (state block ~line 172, after existing engine settings state; effect after `loadStatus` effect ~line 206)

**Interfaces:**
- Produces: `availableEndpoints` (`Array<{id: string, name: string}>`), `endpointsLoading` (`boolean`), `endpointsError` (`null | "403" | "fetch_failed"`) — consumed by Task 2

- [ ] **Step 1: Add three state variables**

In `AuthzTestPage.jsx`, find the engine settings state block (around line 172–177):

```js
// Engine settings panel
const [engineSettingsOpen, setEngineSettingsOpen] = useState(true);
const [engineMode, setEngineMode] = useState("simulated"); // "simulated" | "pingone"
const [endpointId, setEndpointId] = useState("");
const [workerClientId, setWorkerClientId] = useState("");
const [workerClientSecret, setWorkerClientSecret] = useState("");
const [engineSaving, setEngineSaving] = useState(false);
const [engineSaveMsg, setEngineSaveMsg] = useState(null); // {ok, text}
```

Add three lines immediately after `engineSaveMsg`:

```js
const [availableEndpoints, setAvailableEndpoints] = useState([]);
const [endpointsLoading, setEndpointsLoading] = useState(false);
const [endpointsError, setEndpointsError] = useState(null); // null | "403" | "fetch_failed"
```

- [ ] **Step 2: Add the fetch effect**

Find the `useEffect` that calls `loadStatus()` (around line 203–206):

```js
// Load engine status on mount
useEffect(() => {
    loadStatus();
}, [loadStatus]);
```

Add the following effect immediately after it:

```js
// Auto-fetch decision endpoints when PingOne mode is selected
useEffect(() => {
    if (engineMode !== "pingone") return;
    setEndpointsLoading(true);
    setEndpointsError(null);
    apiClient
        .get("/api/authorize/decision-endpoints")
        .then((res) => {
            const eps = res.data?.endpoints ?? [];
            setAvailableEndpoints(eps);
            if (eps.length === 1 && !endpointId) {
                setEndpointId(eps[0].id);
            }
        })
        .catch((err) => {
            const status = err.response?.status;
            if (status === 422) return; // not configured yet — silent
            if (status === 403) {
                setEndpointsError("403");
                return;
            }
            setEndpointsError("fetch_failed");
        })
        .finally(() => setEndpointsLoading(false));
}, [engineMode]); // eslint-disable-line react-hooks/exhaustive-deps
```

Note: `endpointId` is intentionally omitted from the dependency array — we only want to auto-select on mode switch, not re-fire every time the field changes.

- [ ] **Step 3: Verify no runtime errors**

Start the dev server if not already running:
```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npm start
```
Open the authz-test page, switch to "PingOne Authorize" mode. Check the browser console — no errors. The existing text input should still render (Task 2 replaces it).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AuthzTestPage.jsx
git commit -m "feat(authz): add decision endpoint auto-fetch state and effect"
```

---

### Task 2: Replace text input with conditional render

**Files:**
- Modify: `demo_api_ui/src/components/AuthzTestPage.jsx` (Decision Endpoint ID label block ~line 641–654)

**Interfaces:**
- Consumes: `availableEndpoints`, `endpointsLoading`, `endpointsError`, `endpointId`, `setEndpointId` (all from Task 1 / existing state)

- [ ] **Step 1: Locate the existing Decision Endpoint ID label block**

Find this block (around line 641–654):

```jsx
<label className="authz-label">
    Decision Endpoint ID
    <input
        type="text"
        className="authz-input"
        value={endpointId}
        onChange={(e) => setEndpointId(e.target.value)}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        autoComplete="off"
    />
    <span className="authz-engine-creds-hint">
        From PingOne Authorize → Decision Endpoints
    </span>
</label>
```

- [ ] **Step 2: Replace with the conditional render block**

Replace the entire label block above with:

```jsx
<label className="authz-label">
    Decision Endpoint ID
    {endpointsLoading ? (
        <input
            type="text"
            className="authz-input"
            value=""
            placeholder="Fetching endpoints…"
            disabled
            readOnly
        />
    ) : availableEndpoints.length > 1 ? (
        <select
            className="authz-input"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
        >
            <option value="">— select an endpoint —</option>
            {availableEndpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                    {ep.name}
                </option>
            ))}
        </select>
    ) : (
        <input
            type="text"
            className="authz-input"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
        />
    )}
    <span className="authz-engine-creds-hint">
        {endpointsError === "403"
            ? "Admin required to fetch endpoint list"
            : endpointsError === "fetch_failed"
              ? "Could not fetch endpoint list — enter ID manually"
              : availableEndpoints.length === 1
                ? `Auto-selected: ${availableEndpoints[0].name}`
                : "From PingOne Authorize → Decision Endpoints"}
    </span>
</label>
```

- [ ] **Step 3: Manual smoke test**

With the dev server running, open the authz-test page:

a. **Worker creds not saved / 422 case:** Switch to PingOne mode. The text input should appear normally with the original hint. No error in console.

b. **403 case (not admin):** If logged in as a non-admin user, switch to PingOne mode. Hint should read "Admin required to fetch endpoint list". Text input still editable.

c. **Multiple endpoints case (if you have PingOne creds saved):** Switch to PingOne mode. A `<select>` dropdown appears with endpoint names. Choosing one updates the field.

d. **Single endpoint case:** If only one endpoint exists and `endpointId` was empty, it auto-fills and hint reads "Auto-selected: [name]".

e. **Apply Engine still works:** Fill in credentials, click Apply Engine — save behaviour unchanged.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AuthzTestPage.jsx
git commit -m "feat(authz): replace decision endpoint text input with auto-populated dropdown"
```
