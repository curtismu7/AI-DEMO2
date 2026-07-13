# Ailines Vertical Design Spec

**Date:** 2026-07-13  
**Author:** Claude Code  
**Status:** Design phase  

---

## Executive Summary

Build a complete airline vertical for AI-DEMO2 using Southwest Airlines as the reference brand. The vertical demonstrates:

1. **Full-stack vertical scaffolding** — automated config generation from branding data
2. **Real brand integration** — Southwest logo, colors, terminology via Brandfetch API
3. **Tiered authorization** — Standard/Premium tiers with restricted actions (cancellations need HITL consent)
4. **Security showcases** — HITL consent, step-up MFA, cross-vertical deny scenarios

**Deliverables:**
- Branding Fetcher (`scripts/fetch-branding.js`) — Brandfetch API integration with caching
- Vertical Scaffolder (`scripts/scaffold-vertical.js`) — generates manifest.json, index.js, mock-data.json from domain spec
- Ailines Vertical — complete Southwest Airlines vertical (frontend theming, backend config, MCP tools)
- Reusable Skill — guidance for building future verticals

---

## 1. Branding Fetcher

### Purpose
Autonomous tool that fetches company branding from Brandfetch API and returns structured JSON suitable for vertical scaffolding.

### Input
```json
{
  "companyName": "Southwest Airlines",
  "domain": "southwest.com",
  "industry": "airline"
}
```

### Output
Real Southwest data (fetched 2026-07-13):
```json
{
  "identity": {
    "displayName": "Southwest Airlines",
    "domain": "southwest.com",
    "tagline": "No matter what comes up in your travels, we've got your back",
    "logoUrl": "https://cdn.brandfetch.io/idv6L4YsR7/theme/dark/logo.svg",
    "logoAlt": "Southwest Airlines logo",
    "description": "Major low-cost carrier headquartered in Dallas",
    "longDescription": "Southwest Airlines is a major American airline..."
  },
  "theme": {
    "primaryColor": "#304CB2",        // Brand blue
    "accentColor": "#FFCA4F",         // Yellow
    "lightColor": "#FFFFFF",
    "darkColor": "#111B40",
    "fonts": {
      "title": "Southwest Sans",
      "body": "Southwest Sans"
    }
  },
  "company": {
    "founded": 1971,
    "employees": 10001,
    "industries": ["Travel and Tourism", "Air Travel"],
    "ticker": "LUV"
  },
  "socialLinks": {
    "twitter": "https://twitter.com/SouthwestAir",
    "instagram": "https://instagram.com/southwestair",
    "facebook": "https://facebook.com/SouthwestAir"
  },
  "fetchedAt": "2026-07-13T10:00:00Z",
  "qualityScore": 0.961
}
```

### Implementation Details

**File:** `scripts/fetch-branding.js`

**CLI usage:**
```bash
npm run fetch-branding -- --company "Southwest Airlines" --domain southwest.com
```

**Features:**
- Uses Brandfetch API v2 (`https://api.brandfetch.io/v2/brands/{domain}`)
- Brandfetch API key from env var: `BRANDFETCH_API_KEY`
- Caches results locally in `.cache/branding/{domain}.json` (avoid re-fetching)
- Graceful degradation on missing fields (uses sensible defaults)
- Returns confidence levels for each field (high/medium/low/manual)
- On API failure → falls back to manual config in `scripts/brand-overrides/{domain}.json`

**Dependencies:**
- `node-fetch` or built-in `fetch` (Node 18+)
- Caching via `fs` + JSON

**Error handling:**
- Network error → log, fall back to manual config
- Invalid response → graceful degrade, return defaults
- Missing fields → use industry-standard colors (airline blue)

---

## 2. Vertical Scaffolder

### Purpose
Template engine that generates all three vertical layers from branding data + domain spec JSON.

### Input

**Branding data** (from Brandfetch, or manual override)

**Domain spec** JSON (`config/ailines-domain-spec.json`):
```json
{
  "verticalId": "ailines",
  "displayName": "Southwest Airlines",
  "industry": "airline",
  "terminology": {
    "booking": "Reservation",
    "bookings": "Reservations",
    "flight": "Flight",
    "seat": "Seat",
    "passenger": "Passenger",
    "price": "Fare",
    "agent": "Travel Agent"
  },
  "actions": [
    {
      "name": "get_bookings",
      "label": "View Reservations",
      "description": "List user's upcoming reservations",
      "scopes": ["read"],
      "authz": {}
    },
    {
      "name": "get_flight_status",
      "label": "Flight Status",
      "description": "Check flight status, gate, boarding time",
      "scopes": ["read"],
      "authz": {}
    },
    {
      "name": "check_seat_availability",
      "label": "Available Seats",
      "description": "Show seat map for the flight",
      "scopes": ["read"],
      "authz": {}
    },
    {
      "name": "change_seat",
      "label": "Change Seat",
      "description": "Select a different seat",
      "scopes": ["write"],
      "authz": {}
    },
    {
      "name": "cancel_booking",
      "label": "Cancel Booking",
      "description": "Cancel a reservation and process refund",
      "scopes": ["write"],
      "authz": { "consent": true }
    },
    {
      "name": "modify_booking",
      "label": "Modify Booking",
      "description": "Change flight date/time",
      "scopes": ["write"],
      "authz": { "stepUp": true }
    },
    {
      "name": "add_checked_bag",
      "label": "Add Checked Bag",
      "description": "Add additional baggage to reservation",
      "scopes": ["write"],
      "authz": {}
    }
  ],
  "tiers": {
    "default": "Standard",
    "definitions": {
      "Standard": {
        "allowedActions": [
          "get_bookings",
          "get_flight_status",
          "check_seat_availability",
          "change_seat",
          "add_checked_bag"
        ],
        "restrictedTools": ["cancel_booking"]
      },
      "Premium": {
        "allowedActions": [
          "get_bookings",
          "get_flight_status",
          "check_seat_availability",
          "change_seat",
          "add_checked_bag",
          "cancel_booking",
          "modify_booking"
        ],
        "restrictedTools": []
      }
    }
  },
  "demoUsers": {
    "customer": {
      "username": "demo.passenger",
      "password": "Tigers7&"
    },
    "admin": {
      "username": "demo.airlineadmin",
      "password": "Tigers7&"
    }
  },
  "mockData": {
    "bookings": [
      {
        "confirmationNumber": "ABC123",
        "flightNumber": "SWA1234",
        "route": "DAL → LAX",
        "departureDate": "2026-08-15",
        "status": "Confirmed"
      }
    ],
    "heroStats": {
      "upcomingTrips": 2,
      "rapidRewardsPoints": 45320,
      "totalFlights": 42,
      "tierStatus": "A-List Member"
    }
  },
  "scopes": {
    "read": "read",
    "write": "write",
    "modify": "modify_bookings",
    "cancel": "cancel_bookings"
  },
  "delegation": {
    "pageTitle": "Travel Authorization",
    "pageDescription": "Grant family members access to your reservations",
    "granteeLabel": "travel companion"
  }
}
```

### Output

Three files generated in `demo_api_server/config/verticals/ailines/`:

1. **manifest.json** — 600+ lines defining identity, theme, terminology, tiers, agent persona, dashboard chips, security showcases, render templates
2. **index.js** — tool definitions, NL heuristics (regex patterns to detect flight/seat/cancel intents), system prompt, executeTool dispatcher
3. **mock-data.json** — demo reservation data with hero stats

### Implementation Details

**File:** `scripts/scaffold-vertical.js`

**CLI usage:**
```bash
npm run scaffold-vertical -- \
  --spec config/ailines-domain-spec.json \
  --company "Southwest Airlines" \
  --domain southwest.com
```

**Process:**
1. Load domain spec JSON
2. Fetch branding via `fetch-branding.js` (or use cache)
3. Render templates:
   - `templates/manifest.json.ejs` → `demo_api_server/config/verticals/{id}/manifest.json`
   - `templates/index.js.ejs` → `demo_api_server/config/verticals/{id}/index.js`
   - `templates/mock-data.json.ejs` → `demo_api_server/config/verticals/{id}/mock-data.json`
4. Optional: scaffold MCP server (`demo_mcp_server/src/{id}/index.ts`)
5. Validate output:
   - All tools in manifest are defined
   - Heuristics reference valid tool names
   - Scopes consistent
   - Demo users have matching terminology

**Dependencies:**
- `ejs` for templating
- Validation via JSON schema

---

## 3. Southwest Airlines Vertical (ailines)

### 3.1 Frontend
Reuses existing vertical theme system in `demo_api_ui/src/vertical/`:
- VerticalProvider applies Southwest colors via CSS variables
- Logo loaded from URL
- No new React components needed

### 3.2 Backend Configuration

**manifest.json structure:**
- `identity` — Southwest display name, logo, tagline
- `theme` — CSS variables (blue #304CB2, yellow #FFCA4F, dark #111B40)
- `terminology` — airline-specific language (Reservation, Flight, Seat, Fare)
- `tiers` — Standard (limited actions) vs Premium (full access including cancellations)
- `groups` — membership categories (premium tier)
- `agent` — persona ("Southwest Travel Agent"), greeting, system prompt
- `dashboard` — chips for common actions (My Reservations, Flight Status, Change Seat, Cancel)
- `scopes` — OAuth scopes (read, write, modify_bookings, cancel_bookings)
- `delegation` — travel companion access control
- `render` — templates for displaying reservation data, flight status, seat changes, boarding passes
- `demoUsers` — demo.passenger, demo.airlineadmin
- `securityShowcase` — HITL consent for cancellations, step-up MFA for modifications, cross-vertical deny

**NL Heuristics** (in index.js):
- `/\bbook|reservation|flight/` → get_bookings
- `/\bstatus|gate|boarding/` → get_flight_status
- `/\bseat|chair|row\b/` → check_seat_availability / change_seat
- `/\bcancel|refund|change.*flight/` → cancel_booking / modify_booking
- `/\b(bag|baggage|luggage|checked)/` → add_checked_bag

**Authorization tier restrictions:**
- Standard: cannot cancel bookings (tool restricted)
- Premium: can cancel + modify bookings

### 3.3 MCP Server

**File:** `demo_mcp_server/src/ailines/index.ts`

**Tool implementations:**
- `get_bookings()` — query user's reservations, validate scope, return booking list
- `get_flight_status()` — check flight status, gate, boarding time (read scope)
- `check_seat_availability()` — seat map for the flight (read scope)
- `change_seat()` — update seat assignment (write scope)
- `cancel_booking()` — cancel reservation, validate tier, trigger HITL consent (write + cancel scope, consent required)
- `modify_booking()` — change flight date/time (write + modify scope, step-up required)
- `add_checked_bag()` — add baggage to reservation (write scope)

**Each tool:**
- Validates user token against required scopes
- Checks tier restrictions (Standard/Premium)
- Validates request parameters
- Logs action to token chain (for security showcases)
- Returns structured response or error
- Triggers consent/step-up when authz requires it

---

## 4. Dashboard & Security Showcases

### Chips (Quick Actions)
- "My Reservations" → get_bookings
- "Flight Status" → get_flight_status
- "Available Seats" → check_seat_availability
- "Change Seat" → change_seat
- "🔐 Cancel Booking" → cancel_booking (HITL consent trigger)
- "Checked Bags" → add_checked_bag

### Security Showcases

**Defenses tab:**
- **HITL Consent** — "Cancel booking" triggers human approval (HITL gate)
- **Step-up MFA** — "Modify flight" requires OTP/passkey verification
- **Cross-vertical deny** — attempting to access banking tools from airline vertical fails (PingOne Authorize policy)

**AI Reasoning tab:**
- **Pattern analysis** — "Analyze my trip patterns"
- **Explain blocks** — "Why was I blocked from canceling?"

---

## 5. Implementation Timeline

| Phase | Task | Effort | Dependencies |
|-------|------|--------|--------------|
| 1 | Branding Fetcher (fetch-branding.js) | 1h | Brandfetch API key |
| 2 | Vertical Scaffolder (scaffold-vertical.js + templates) | 2h | Phase 1 complete |
| 3 | Generate ailines config (manifest.json, index.js) | 30m | Phase 2 complete |
| 4 | Implement MCP tools (demo_mcp_server/src/ailines/) | 2h | Phase 3 complete |
| 5 | Wire into UI (vertical picker, theme) | 30m | Phases 3-4 |
| 6 | Test end-to-end | 1h | Phases 1-5 |
| 7 | Create reusable skill | 1h | Phases 1-6 |

**Total:** ~8 hours

---

## 6. Success Criteria

### Branding Fetcher
- ✅ Fetches real Southwest branding (logo URL, colors, fonts, company info)
- ✅ Caches results locally
- ✅ Gracefully degrades on missing fields (uses defaults)
- ✅ Supports manual overrides

### Vertical Scaffolder
- ✅ Generates valid manifest.json with all required sections
- ✅ Generates valid index.js with tool defs and heuristics
- ✅ Generates mock-data.json with demo reservations
- ✅ Validates output consistency (tools, heuristics, scopes)

### Ailines Vertical
- ✅ Appears in vertical picker with Southwest logo and colors
- ✅ Demo user can log in, view reservations, change seats
- ✅ Tier restrictions work (Standard cannot cancel, Premium can)
- ✅ HITL consent gate triggers for cancellations
- ✅ Step-up MFA triggers for booking modifications
- ✅ Cross-vertical deny works (banking tools blocked)
- ✅ NL routing detects flight/seat/cancel intents correctly
- ✅ Dashboard shows hero stats (upcoming trips, points, tier status)

### Reusable Skill
- ✅ Documents process for building future verticals
- ✅ Guides users through branding fetch → scaffolder → implementation

---

## 7. Out of Scope

- Payment processing integration
- Real flight booking backend (uses mock data)
- Mobile app support (UI only)
- Multi-language support
- Email notifications for booking changes
- Integration with real airline APIs (e.g., SabreAPI)

---

## 8. Dependencies & Assumptions

**External:**
- Brandfetch API (API key provided: `gGaWLx9xPvlT56hq8GXLDBy1VZ6aiU4vr7zPy-OEVy_AwCeOS0Sxgyl9gmEZm-dxE6vMp6UnN2Y5_fyvUjbsFQ`)
- PingOne Authorize for gateway policy (cross-vertical deny)
- PingOne HITL service for consent gates

**Internal:**
- Existing vertical infrastructure (VerticalProvider, verticalManifest, dashboard chips)
- PingOne OAuth + RFC 8693 token exchange
- MCP tool dispatch system

**Assumptions:**
- Demo data (reservations, flights) are synthetic/mock (no real Southwest data)
- Brandfetch quality score is acceptable (> 0.9)
- Existing banking vertical patterns are stable (no breaking changes planned)

