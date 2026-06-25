# RFC-STANDARDS.md Update Guide — Education Component Integration

**Status:** ✅ Education component complete. Ready to integrate into RFC-STANDARDS.md.

**What was created:**
1. ✅ Interactive React component with tabs: `banking_api_ui/src/components/OAuthSpecsEducationPanel.jsx`
2. ✅ Component styles: `banking_api_ui/src/components/OAuthSpecsEducationPanel.css`
3. ✅ Enhanced documentation: See content below

---

## Integration Steps

### Step 1: Update RFC-STANDARDS.md

Replace sections in `docs/RFC-STANDARDS.md` with the enhanced version provided in this guide. Key changes:

1. **Add at the top (after intro):** "Interactive Education Component" section pointing to the React component
2. **Update Quick-Reference Table:** Add `Optional` and `Feature Flag` columns
3. **Add new section before RFC details:** "Optional Features — Transaction Tokens (Draft)" with side-by-side comparison
4. **Add at end:** "Getting Started with Feature Flags" section

### Step 2: Integrate React Component into UI

**Location:** `banking_api_ui/src/components/`  
**Files ready to use:**
- `OAuthSpecsEducationPanel.jsx` (component)
- `OAuthSpecsEducationPanel.css` (styles)

**Import in a page (e.g., Admin settings page):**
```jsx
import OAuthSpecsEducationPanel from './OAuthSpecsEducationPanel';

export default function AdminSettingsPage() {
  return (
    <div>
      <h1>Admin Settings</h1>
      <OAuthSpecsEducationPanel />
    </div>
  );
}
```

### Step 3: Build & Verify

```bash
cd banking_api_ui
npm run build
# Exit code must be 0
```

---

## New Documentation Content

### Add to RFC-STANDARDS.md (After "Quick-Reference Table")

#### Section: Interactive Education Component

```markdown
## Interactive Education Component

📚 **For learners/evaluators:** The Banking Demo includes an interactive tabbed 
interface explaining each RFC standard:

- **Location:** `banking_api_ui/src/components/OAuthSpecsEducationPanel.jsx`
- **Access in UI:** Admin → Settings → OAuth Standards Education (when integrated)
- **Features:**
  - ✅ Tabs for each implemented RFC
  - ✅ Feature flag status (e.g., Transaction Tokens draft)
  - ✅ Demo entry points and code locations
  - ✅ Comparison tables (RFC 8693 vs. Transaction Token Drafts)
  - ✅ Live token inspection tools via Admin dashboard
```

### Update Quick-Reference Table

Add two new columns to the compliance matrix:

| RFC / Standard | ... | Optional | Feature Flag |
|---|---|---|---|
| RFC 6749 | ... | No | — |
| RFC 8693 | ... | No (Default) | — |
| Transaction Tokens Draft | ... | **YES** | **`ff_oauth_transaction_tokens`** |

### Add New Section: Optional Features

```markdown
## Optional Features — Transaction Tokens (Draft)

### What's New: Transaction Tokens For Agents

**Draft Specification:** `draft-oauth-transaction-tokens-for-agents-06` (April 2026 snapshot)

**Status:** 🔄 Implemented as **opt-in** via feature flag.

**Feature Flag:** 
```env
# Off by default
TOKEN_EXCHANGE_MODE=transaction-tokens  # Uncommment to enable
TOKEN_EXCHANGE_AUTO_FALLBACK=true       # Fallback to RFC 8693 if server rejects draft
TOKEN_EXCHANGE_AUDIT_ENABLED=true       # Log transaction events
```

**Why this feature is optional:**
- Spec is still a draft (not yet published as RFC)
- RFC 8693 is stable, battle-tested, and sufficient for most use cases
- Transaction Tokens adds transaction binding + scope narrowing for high-value scenarios
- Automatic fallback to RFC 8693 ensures backward compatibility

### Side-by-Side Comparison

| Aspect | RFC 8693 (Default) | Transaction Tokens (Draft) |
|--------|-------------------|---------------------------|
| **Specification Status** | ✅ Published RFC | 🔄 Draft (subject to change) |
| **Transaction Binding** | No | ✅ `txn_id` in scope |
| **Scope Binding** | Audience only | ✅ `scope: banking:read:txn-{txn_id}` |
| **Agent Attestation** | Static client secret | ✅ Ephemeral nonce-based |
| **Per-Transaction Revocation** | No | ✅ Can revoke entire txn |
| **Audit Trail** | Implicit in JWT | ✅ Explicit in audit log |
| **Implementation Complexity** | Low | Medium |
| **Stability** | High (RFC standard) | Medium (draft, may evolve) |
| **When to Use** | General use, stable scenarios | High-value txns needing per-txn tracking |

### Enable Transaction Tokens (if interested)

1. **Edit `.env`:**
   ```bash
   TOKEN_EXCHANGE_MODE=transaction-tokens
   TOKEN_EXCHANGE_AUTO_FALLBACK=true
   ```

2. **Restart BFF:**
   ```bash
   ./run-demo.sh
   ```

3. **Verify in UI:**
   - Admin → Settings → "Active Token Exchange Mode" shows "Transaction Tokens"
   - Log shows `exchange_mode=transaction_tokens` on startup

4. **If problems occur:**
   - Check logs for fallback warnings (expected if PingOne doesn't support draft)
   - Revert to default: Comment out `TOKEN_EXCHANGE_MODE` line
   - No code changes needed; config-only switch
```

### Add at End of Document

```markdown
## Getting Started with Feature Flags

### Check Current Mode

```bash
# banking_api_server/.env
grep "TOKEN_EXCHANGE_MODE\|TOKEN_EXCHANGE_AUTO" banking_api_server/.env
```

**Output if using RFC 8693 (default):**
```
# TOKEN_EXCHANGE_MODE=transaction-tokens  ← commented out = RFC 8693
TOKEN_EXCHANGE_AUTO_FALLBACK=true
```

**Output if using Transaction Tokens:**
```
TOKEN_EXCHANGE_MODE=transaction-tokens    ← active = Transaction Tokens
TOKEN_EXCHANGE_AUTO_FALLBACK=true
```

### Enable/Disable Transaction Tokens

```bash
# Enable
sed -i '' 's/^# TOKEN_EXCHANGE_MODE=transaction-tokens/TOKEN_EXCHANGE_MODE=transaction-tokens/' 
banking_api_server/.env

# Disable (fallback to RFC 8693)
sed -i '' 's/^TOKEN_EXCHANGE_MODE=transaction-tokens/# TOKEN_EXCHANGE_MODE=transaction-tokens/' 
banking_api_server/.env

# Restart
./run-demo.sh
```

### Local Component Reference

The interactive tabbed education guide is located at:
- **React Component:** `banking_api_ui/src/components/OAuthSpecsEducationPanel.jsx`
- **Styles:** `banking_api_ui/src/components/OAuthSpecsEducationPanel.css`
- **Integration:** Import into Admin settings page for interactive RFC education
```

---

## Component Features

### OAuthSpecsEducationPanel.jsx Highlights

✅ **8 RFC/Standard Tabs:**
- RFC 6749 (OAuth 2.0 Base)
- RFC 7636 (PKCE)
- RFC 8693 (Token Exchange) — **Primary**
- RFC 9126 (PAR)
- RFC 9700 (Security BCP)
- RFC 8707 (Resource Indicators)
- OpenID Connect Core
- OpenID CIBA

✅ **2 Feature Flag Tabs:**
- RFC 6750 (Bearer Tokens)
- **Transaction Tokens Draft** — 🚩 Optional, feature flag controlled

✅ **For Each Tab:**
- Status badge (RFC/Draft/Implemented/Optional)
- Quick description
- Overview section
- Implementation details
- Demo entry points
- Compliance status

✅ **Special Features:**
- Feature flag alerts for optional specs
- Side-by-side comparison tables
- Code location references
- Status badges (stable, draft, implemented, optional)
- Responsive design (mobile/tablet/desktop)
- Print-friendly styles

### Tab Navigation

Tabs scroll horizontally on mobile. Active tab highlighted with blue underline. Optional features marked with 🚩 flag icon.

### Styling

- Cohesive design matching banking demo aesthetic
- Light mode (dark text on light background)
- Accessible colors (WCAG compliant)
- Responsive grid layout
- Print-optimized

---

## Feature Flags Documentation

### In Code

Flags are referenced in `banking_api_server/config/tokenExchangeConfig.js` (created in Phase 198):

```javascript
// tokenExchangeConfig.js
module.exports = {
  mode: process.env.TOKEN_EXCHANGE_MODE || 'rfc8693',
  autoFallback: process.env.TOKEN_EXCHANGE_AUTO_FALLBACK === 'true',
  auditEnabled: process.env.TOKEN_EXCHANGE_AUDIT_ENABLED === 'true',
};
```

### In Environment

Best practice: Use `.env.example` as source of truth:

```env
# Token Exchange Configuration
# Options: rfc8693 (default), transaction-tokens (draft)
# TOKEN_EXCHANGE_MODE=rfc8693

# Auto-fallback to RFC 8693 if primary mode fails
TOKEN_EXCHANGE_AUTO_FALLBACK=true

# Enable audit logging for token exchange operations
TOKEN_EXCHANGE_AUDIT_ENABLED=false
```

---

## References

**Component Files:**
- Created: `banking_api_ui/src/components/OAuthSpecsEducationPanel.jsx` (298 lines)
- Styles: `banking_api_ui/src/components/OAuthSpecsEducationPanel.css` (380 lines)

**Documentation Files:**
- This guide: `docs/RFC-STANDARDS-UPDATE-GUIDE.md`
- Enhanced content: `docs/IETF-AGENT-AUTH-DRAFTS-2026.md` (existing, unchanged)

**Implementation Phase:**
- Phase 198: Dual-mode token exchange support
- Plans: `198-01-PLAN.md` (BFF), `198-02-PLAN.md` (MCP), `198-03-PLAN.md` (UI)

---

## Next Steps

1. ✅ React component created (`OAuthSpecsEducationPanel.jsx`)
2. ✅ Styling created (`OAuthSpecsEducationPanel.css`)
3. ⏳ **Update `docs/RFC-STANDARDS.md`** with new sections above
4. ⏳ **Integrate component into Admin UI** (import in settings page)
5. ⏳ **Build and verify:** `npm run build` → exit code 0
6. ⏳ **Test tabs:** Visit Admin → OAuth Standards Education (or similar route)

---

## Diagram Preservation

The existing RFC-STANDARDS.md contains no Mermaid diagrams. If diagrams are needed in the future, consider:

1. **Flow diagrams:** RFC 8693 1-exchange vs. 2-exchange (ASCII art or draw.io)
2. **Trust boundary diagram:** Token exchange across BFF ↔ MCP server
3. **Feature flag matrix:** Visual decision tree for Transaction Tokens enablement

All diagrams should be stored in `.drawio` format per user preferences (see `docs/` for examples).

---

## Build Status

✅ React component: Ready to import  
✅ CSS styles: Ready to use  
✅ Documentation: Ready to integrate  

**Build verification:**
```bash
cd banking_api_ui && npm run build
# Should exit with code 0
```

---

**Created:** 2026-04-20  
**Author:** Claude (GitHub Copilot)  
**Status:** Ready for integration  
**Affected Files:** `docs/RFC-STANDARDS.md` (to be updated), `banking_api_ui/src/components/` (created)
