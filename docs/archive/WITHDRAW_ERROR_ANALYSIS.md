# "From account not found" Error Analysis

## Error Flow
1. User types: "withdraw" or similar action chip
2. Agent parses parameters: amount, fromId (account name)
3. Agent looks up account by name → converts to account ID
4. Agent calls `POST /api/transactions` with `fromAccountId`
5. **ERROR:** Transaction API returns 404 "From account not found"

## Root Causes (Probable Order)

### 1. MOST LIKELY: Account Not Restored After Lambda Recycle
**Location:** transactions.js line 298
```javascript
await restoreAccountsFromSnapshot(userId);
```

**How it works:**
- When Vercel cold-starts, accounts are in-memory only
- Before processing transaction, code calls `restoreAccountsFromSnapshot()`
- This restores accounts from Redis/KV using demoScenarioStore
- If snapshot is missing/empty, accounts aren't restored → 404

**Fix:** Ensure `accountSnapshot` is being saved when accounts are created/modified

### 2. AccountSnapshot Not Being Saved
**Location:** transactions.js - needs to be added

**Current behavior:**
- `restoreAccountsFromSnapshot()` reads from Redis
- BUT there's NO code that WRITES the snapshot when accounts change
- Result: On cold-start, snapshot is empty → accounts not restored

**What should happen:**
```javascript
// After creating/modifying accounts:
const allAccounts = dataStore.getAccountsByUserId(userId);
const scenario = await demoScenarioStore.load(userId);
await demoScenarioStore.save(userId, {
  ...scenario,
  accountSnapshot: allAccounts
});
```

**Files affected:**
- accounts.js (when accounts are created/modified)
- demoDataPage routes (when demo data is reset)

### 3. Agent Parsing Error
**Location:** bankingAgentLangGraphService.js line 165
```javascript
const fromAcct = accounts?.find(a => 
  a.accountType?.toLowerCase() === params.fromId?.toLowerCase() || 
  a.id === params.fromId
);
```

**Possible issues:**
- `accounts` array is empty (not loaded from user's stored accounts)
- `params.fromId` doesn't match any account type (spelling/case mismatch)
- Account was deleted but agent still references it

**Error message check:** If agent couldn't find account, it returns:
```javascript
"❌ Could not find account "{params.fromId}". Your accounts: ..."
```
This is NOT the user's error → agent did find an account

### 4. UserId Mismatch
**Location:** transactions.js line 364
```javascript
if (fromAccount.userId !== req.user.id) {
  return res.status(403).json({ error: 'Access denied' });
}
```

**Unlikely** but possible:
- Account was created by different user
- Session user changed mid-transaction
- Concurrency issue with multiple users

---

## Diagnostic Checklist

To determine root cause, check:

1. **Are accounts being loaded from database?**
   - Look in browser DevTools Network tab
   - GET /api/accounts/my should return account list
   - Verify accounts have `id` fields

2. **Is accountSnapshot saved?**
   - Check Redis/KV for `demo:${userId}` key
   - Should contain `accountSnapshot: [...]`
   - If empty array or missing → accounts won't restore

3. **Is agent getting correct account list?**
   - Agent action reply shows: "Your accounts: checking, savings, ..."
   - If that list is empty → accounts not loaded by agent

4. **Is account ID correct?**
   - Agent converts "checking" → account.id (e.g., "acc_123abc...")
   - Transaction API receives that account ID
   - Check if ID exists: `dataStore.getAccountById(id)`

---

## Fixes Required

### FIX #1: Save accountSnapshot When Accounts Change (CRITICAL)

**File:** banking_api_server/routes/accounts.js

After account creation/modification, add:
```javascript
// Save snapshot for cold-start recovery
const allAccounts = dataStore.getAccountsByUserId(userId);
const scenario = await demoScenarioStore.load(userId);
await demoScenarioStore.save(userId, {
  ...scenario,
  accountSnapshot: allAccounts
});
```

**Where to add:**
- After POST /api/accounts (account creation)
- After PATCH /api/accounts/:id (account update)
- After DELETE /api/accounts/:id (account deletion)

### FIX #2: Ensure Account List Loads on App Start

**File:** banking_api_ui/src/components/Dashboard.js or AccountsHydration

Check that `GET /api/accounts/my` is called when user logs in.

Verify it's not cached incorrectly between sessions.

### FIX #3: Better Error Messages

**File:** bankingAgentLangGraphService.js line 167

Current: `"❌ Could not find account "{params.fromId}"..."`

Add account loading attempt:
```javascript
// Force reload accounts in case they're stale
const accounts = await dataStore.getAccountsByUserId(userId);
if (!accounts || accounts.length === 0) {
  return { reply: '⚠️ No accounts found. Please check your account list and try again.', ... };
}
```

---

## Prevention

1. **Every time accounts change**, save to accountSnapshot
2. **Unit test:** Verify accounts restore after cold-start
3. **Integration test:** Withdraw → cold-start → confirm transaction still accessible
4. **E2E test:** Create account → cold-start → verify in agent

---

## Testing Flow

1. Create demo account (e.g., "Checking" account with $1000)
2. Try withdrawal: "Withdraw $100"
3. If success → error not yet triggered
4. Simulate Vercel cold-start (restart server or clear in-memory cache)
5. Try withdrawal again
6. **Expected:** Error triggers here
7. **Cause:** accountSnapshot wasn't saved in step 1

