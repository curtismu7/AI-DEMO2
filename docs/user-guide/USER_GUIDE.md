# Super Banking User Guide

> Guide for using the demo application, including MFA setup, AI agent interactions, and common workflows.
>
> **This is a demonstration, not a real bank.** It is a multi-vertical AI-agent-security demo that shows
> how PingOne OAuth, RFC 8693 token exchange, MCP tools, human-in-the-loop (HITL) consent, and step-up MFA
> protect an AI agent's actions. The default vertical is **Super Banking**; the same platform can be skinned
> as other verticals (healthcare, retail, workforce, sporting-goods). All account data is sample/mock data.
> See [Switching Verticals](#15-switching-verticals) below.

**For technical setup and configuration, see:**
- [SETUP.md](SETUP.md) — Complete setup guide for developers
- [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](../PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) — Authoritative PingOne configuration reference

---

## Table of Contents

1. [Getting Started](#1-getting-started)
   - [Switching Verticals](#15-switching-verticals)
2. [Multi-Factor Authentication (MFA)](#2-multi-factor-authentication-mfa)
3. [AI Banking Agent](#3-ai-banking-agent)
4. [Common Banking Workflows](#4-common-banking-workflows)
5. [Security Best Practices](#5-security-best-practices)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Getting Started

### 1.1 Login

**As an Admin:**
1. Navigate to `/admin` or click "Log In as Admin" on the landing page
2. You'll be redirected to PingOne for authentication
3. Enter your admin credentials
4. After successful login, you'll land on the admin dashboard

**As a Customer:**
1. Navigate to `/dashboard` or click "Log In" on the landing page
2. You'll be redirected to PingOne for authentication
3. Enter your customer credentials
4. After successful login, you'll land on your customer dashboard

### 1.2 Dashboard Overview

**Admin Dashboard:**
- View all users and accounts
- Manage transactions
- Configure application settings
- Monitor system activity
- Access audit logs

**Customer Dashboard:**
- View your accounts and balances
- See recent transactions
- Initiate transfers
- Access AI agent
- Manage your profile

### 1.5 Switching Verticals

The demo ships with several industry "skins" (verticals). The default is **Super Banking**; others include
healthcare, retail, workforce, and sporting-goods. Switching verticals re-themes the UI, swaps the sample
data, and changes the AI agent's persona and available tools — the underlying identity/security plumbing
(OAuth, token exchange, MCP, HITL, step-up MFA) stays the same.

An admin selects the active vertical from the Admin area. This is a demo control for showing the same
security model across different industries; it is not a per-customer setting. <!-- TODO: verify exact Admin path -->

---

## 2. Multi-Factor Authentication (MFA)

### 2.1 What is MFA?

Multi-Factor Authentication (MFA) adds an extra layer of security by requiring a second form of verification.
In this demo, MFA is used as a **step-up** check at transaction time — a money-movement request above the
step-up threshold (default **$500**) triggers an additional verification before it completes.

This is distinct from the **HITL consent gate** (see below): the two are separate controls that can both fire.

### 2.2 Two Transaction Gates

The demo enforces money-movement with two independent, server-configurable gates:

| Gate | Default threshold | What happens |
|------|-------------------|--------------|
| **HITL consent** | $250 | The agent pauses and surfaces a consent challenge (HTTP **428**). You approve or decline in the UI; an OTP confirms the approval. **All transfers require consent regardless of amount.** |
| **Step-up MFA** | $500 | An additional MFA verification is required before the transaction completes. |

A large transfer can trigger **both** gates in sequence (consent first, then step-up). Admins can change
either threshold live from the Admin controls.

### 2.3 Supported MFA Methods

MFA device enrollment is managed in the **Security Center** (the `/security` page). Supported enrollment
types are:

1. **Email OTP** — a one-time code sent via email
2. **SMS OTP** — a one-time code sent via text message
3. **Authenticator App (TOTP)** — a time-based code from an authenticator app
4. **Security Key / Passkey (FIDO2)** — hardware security key or platform passkey

### 2.4 Setting Up MFA

1. Log in and open the **Security Center** at `/security` (also linked from the dashboard and the side navigation)
2. Choose an enrollment type (Email OTP, SMS OTP, Authenticator App, or Security Key / Passkey)
3. Follow the type-specific flow — for OTP types you confirm a code; for FIDO2 you register the key/passkey
4. Once enrolled, the device is available for step-up MFA and consent confirmation

### 2.5 Using MFA

When a transaction crosses the step-up threshold, you'll be prompted to complete MFA:

1. Enter the one-time code (Email/SMS/Authenticator) or use your security key / passkey
2. The transaction proceeds after successful verification

**Example: High-Value Transfer**

```
1. Initiate a transfer for $600 (above the $500 step-up threshold)
2. Consent challenge appears (transfers always require consent) — approve it
3. Step-up MFA prompt appears — enter your one-time code
4. Transfer completes successfully
```

### 2.6 MFA Troubleshooting

| Issue | Solution |
|-------|----------|
| No MFA prompt | Ensure you have enrolled a method in the Security Center (`/security`) |
| OTP not received | Check email spam folder; verify your email address / phone number is correct |
| FIDO2 fails | Ensure your browser supports WebAuthn and the key/passkey is registered |

---

## 3. AI Banking Agent

### 3.1 What is the AI Agent?

The AI Banking Agent is an intelligent assistant that helps you with banking operations using natural language. You can ask questions, request transactions, and get financial advice without navigating complex menus.

### 3.2 Accessing the AI Agent

**From Customer Dashboard:**
- Click the floating action button (FAB) in the bottom-right corner
- The agent panel will open on the right side

**From Admin Dashboard:**
- Click the AI Agent button in the navigation
- The agent panel will open

### 3.3 Common AI Agent Interactions

**Check Your Accounts:**
```
User: "Show me my accounts"
Agent: "Here's your account overview:
       - Checking Account: $2,500.00
       - Savings Account: $15,000.00"
```

**Transfer Money:**
```
User: "Transfer $500 from checking to savings"
Agent: "I can transfer $500 from your checking to savings account.
       Confirm this transaction?"
User: "Yes"
   → Consent challenge appears (transfers always require consent)
Agent: "Transfer completed."
```

**View Transactions:**
```
User: "Show me recent transactions"
Agent: "Here are your recent transactions:
       - Whole Foods: -$67.00
       - Deposit: +$500.00
       - Coffee shop: -$4.50"
```

### 3.4 Agent Capabilities

The AI Agent's tools (banking vertical) are:

- **View accounts** — list your accounts with balances
- **Account balance** — balance for a specific account
- **Transactions** — recent transaction history
- **Sensitive account details** — full account and routing numbers (requires step-up MFA)
- **Transfer** — move money between accounts (consent required; step-up over threshold)
- **Deposit** — deposit funds (consent/step-up over thresholds)
- **Withdrawal** — withdraw funds (consent/step-up over thresholds)
- **Mortgage** — view mortgage account details
- **Investments** — view investment accounts / balances / portfolio summary

Other verticals expose their own domain tools.

### 3.5 Agent Limitations

The AI Agent cannot:

- Perform operations that require MFA without your approval
- Access other users' accounts
- Make changes to your account settings
- Bypass security measures
- Perform administrative operations (for customer users)

### 3.6 Agent Troubleshooting

| Issue | Solution |
|-------|----------|
| Agent not responding | Check your internet connection, refresh the page |
| "Could not parse" error | Try rephrasing your request, check if the service is available |
| Agent says "missing scope" | Ensure your user has the correct permissions, contact admin |
| Agent shows white overlay | Collapse and reopen the agent panel |

---

## 4. Common Banking Workflows

### 4.1 Transfer Money

**Step-by-Step:**

1. **Navigate to Transfers**
   - From dashboard, click "Transfers" in the navigation
   - Or use the AI Agent: "Transfer $X from A to B"

2. **Enter Transfer Details**
   - Select source account
   - Select destination account or enter recipient details
   - Enter amount
   - Add optional memo/note

3. **Review and Confirm**
   - Review transfer details
   - If amount exceeds MFA threshold, complete MFA verification
   - Click "Confirm Transfer"

4. **Confirmation**
   - You'll see a confirmation message
   - Transaction will appear in your transaction history

### 4.2 View Account Details

**Step-by-Step:**

1. **Navigate to Accounts**
   - From dashboard, click "Accounts" in the navigation
   - Or use the AI Agent: "Show me my accounts"

2. **Select Account**
   - Click on the account you want to view
   - You'll see account details, balance, and recent transactions

3. **Filter Transactions**
   - Use date range filters
   - Filter by transaction type
   - Search by merchant or description

---

## 5. Security Best Practices

### 5.1 Account Security

**Enable MFA:**
- Register at least one device for MFA
- Enable FIDO2 if you have a security key
- Keep your contact information up to date

**Strong Passwords:**
- Use a unique, strong password for your PingOne account
- Enable password manager for convenience
- Never share your password

**Session Management:**
- Log out when you're done, especially on shared devices
- Don't leave your account unattended
- Use the official logout button

### 5.2 Transaction Security

**Verify Transactions:**
- Always review transaction details before confirming
- Check recipient information carefully
- Enable transaction alerts for amounts over $100

**High-Value Transactions:**
- Be prepared for MFA verification
- Double-check all details
- Contact support immediately if something seems wrong

**Monitor Activity:**
- Review your transaction history regularly
- Report suspicious activity immediately
- Use the AI Agent to review recent transactions

### 5.3 Device Security

**Keep Devices Secure:**
- Use device PIN/biometrics
- Keep operating system updated
- Install security software

**Secure Networks:**
- Avoid public Wi-Fi for sensitive transactions
- Use VPN when on public networks
- Verify HTTPS in browser address bar

**Lost or Stolen Device:**
- Remove the affected MFA device in the Security Center (`/security`)
- Re-enroll a new MFA method
- Change your PingOne password

### 5.4 Phishing Awareness

**Recognize Phishing:**
- Be suspicious of urgent requests
- Verify sender email addresses
- Don't click links in unsolicited emails
- Check URLs before entering credentials

**Report Suspicious Activity:**
- Use the AI Agent: "I think I received a phishing email"
- Contact support immediately
- Forward suspicious emails to security team

---

## 6. Troubleshooting

### 6.1 Login Issues

**Problem: Can't log in**
- Solution: Verify your credentials, check if your account is locked, contact admin

**Problem: Redirect loop after login**
- Solution: Clear browser cookies, try incognito mode, check redirect URI configuration

**Problem: "Invalid state" error**
- Solution: Clear session cookies, ensure session store is configured correctly

### 6.2 Transaction Issues

**Problem: Transaction failed**
- Solution: Check account balance, verify recipient details, ensure sufficient funds

**Problem: MFA not working**
- Solution: Ensure device is registered, try alternative MFA method, check email/spam

**Problem: Transaction pending too long**
- Solution: Wait a few minutes, check transaction history, contact support if still pending

### 6.3 Agent Issues

**Problem: Agent not responding**
- Solution: Check internet connection, refresh the page, check if service is available

**Problem: Agent gives wrong information**
- Solution: Rephrase your request, be more specific, contact support if issue persists

**Problem: Agent can't perform operation**
- Solution: Check if you have required permissions, ensure MFA is completed, contact admin

### 6.4 General Issues

**Problem: Page not loading**
- Solution: Check internet connection, clear browser cache, try different browser

**Problem: Data not updating**
- Solution: Refresh the page, check if session is valid, log out and back in

**Problem: Error message unclear**
- Solution: Contact support with error details, check browser console for technical details

### 6.5 Getting Help

**In-App Help:**
- Use the AI Agent: "I need help with..."
- Review error messages for specific guidance

> **Note:** This is a demonstration application. There is no real customer support, account, or money
> involved — all data is sample data. For technical questions about running the demo, see the developer
> documentation linked below.

---

## 7. Additional Resources

**Technical Documentation:**
- [SETUP.md](SETUP.md) — Complete setup guide for developers
- [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](../PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) — Authoritative PingOne configuration
- [PINGONE_APP_CONFIG.md](../PINGONE_APP_CONFIG.md) — App configuration reference

**Security Documentation:**
- [MFA_SETUP_GUIDE.md](MFA_SETUP_GUIDE.md) — Detailed MFA configuration guide

**Agent Documentation:**
- [AGENT_SHOWCASE_DEMO_SCENARIOS.md](AGENT_SHOWCASE_DEMO_SCENARIOS.md) — Demo scenarios and use cases

---

**Last Updated:** June 8, 2026
