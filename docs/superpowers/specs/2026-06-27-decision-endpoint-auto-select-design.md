# Decision Endpoint Auto-Select Design

**Date:** 2026-06-27  
**Status:** Approved  
**File affected:** `demo_api_ui/src/components/AuthzTestPage.jsx`

## Problem

The PingOne Authorize engine settings form requires the user to manually type a Decision Endpoint ID — a UUID they must copy from the PingOne Authorize console. The backend already has a route (`GET /api/authorize/decision-endpoints`) that can list available endpoints using the saved worker token. The UI doesn't use it.

## Goal

When the user selects "PingOne Authorize" mode in the engine settings panel, automatically fetch the available decision endpoints and:
1. Show a dropdown if multiple endpoints exist
2. Auto-select silently if exactly one exists
3. Degrade gracefully if credentials aren't saved yet or the user isn't admin

## Scope

Frontend only. No backend changes required. One component: `AuthzTestPage.jsx`.

## Design

### Trigger

A `useEffect` with dependency `[engineMode]` fires whenever `engineMode` changes. It only runs when `engineMode === "pingone"`.

### New State

```js
const [availableEndpoints, setAvailableEndpoints] = useState([]);
const [endpointsLoading, setEndpointsLoading] = useState(false);
const [endpointsError, setEndpointsError] = useState(null);
```

`endpointId` (existing state) remains the source of truth and is what gets saved.

### Fetch Logic

```js
useEffect(() => {
  if (engineMode !== "pingone") return;
  setEndpointsLoading(true);
  setEndpointsError(null);
  apiClient.get("/api/authorize/decision-endpoints")
    .then(res => {
      const eps = res.data?.endpoints ?? [];
      setAvailableEndpoints(eps);
      if (eps.length === 1 && !endpointId) {
        setEndpointId(eps[0].id);
      }
    })
    .catch(err => {
      const status = err.response?.status;
      if (status === 422) return; // not configured yet — silent, user is mid-entry
      if (status === 403) {
        setEndpointsError("403");
        return;
      }
      setEndpointsError("fetch_failed");
    })
    .finally(() => setEndpointsLoading(false));
}, [engineMode]);
```

### Error Handling

| Status | Behaviour |
|--------|-----------|
| 422 | Silent — user hasn't saved credentials yet, text input unchanged |
| 403 | Hint: "Admin required to fetch endpoint list" — text input still usable |
| 502 / network | Hint: "Could not fetch endpoint list — enter ID manually" |

### UI Rendering (Decision Endpoint ID field)

Replaces the existing plain `<input type="text">` in the credentials grid with conditional rendering:

| State | Rendered |
|-------|----------|
| `endpointsLoading` | Disabled text input, placeholder "Fetching endpoints…" |
| `availableEndpoints.length > 1` | `<select>` populated with endpoints, pre-selecting current `endpointId`. Hint: "From PingOne Authorize → Decision Endpoints" |
| `availableEndpoints.length === 1` | Text input (auto-filled, still editable). Hint: "Auto-selected: [name]" |
| `availableEndpoints.length === 0` and no error | Plain text input, original hint |
| `endpointsError === "403"` | Plain text input. Hint: "Admin required to fetch endpoint list" |
| `endpointsError === "fetch_failed"` | Plain text input. Hint: "Could not fetch endpoint list — enter ID manually" |

`<select>` onChange: `setEndpointId(e.target.value)`.

Existing CSS classes used: `authz-input`, `authz-engine-creds-hint`. No new classes needed.

## Success Criteria

- Switching to "PingOne Authorize" mode fires the fetch
- If 1 endpoint returned and `endpointId` is empty → `endpointId` auto-filled
- If multiple endpoints → dropdown renders, pre-selecting saved ID if it matches
- 422 response → no visible change to the form
- 403 response → hint text updated, text input still usable
- 502/network error → hint updated, text input still usable
- "Apply Engine" save behaviour unchanged
