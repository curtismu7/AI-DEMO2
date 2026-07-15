# How To Set Up the Shared Privilege Demo (SE1)

Shared PingOne Privilege stays online for all SEs. Demo Engineering hosts the multi-tenant environment; you bring local Admin and End User machines (or Windows 11 VMs), complete onboarding once, snapshot, then run the script from the in-app hub.

**In-app hub:** `/privilege-demo` (Setup checklist + Script acts)

## Prerequisites

- PingIdentity SE mailbox (`{seemail}@pingidentity.com`) — reset and MFA codes land here
- Dedicated Chrome profile (passkeys / MFA are profile-bound)
- Two machines or local Windows 11 VMs: **Privilege Admin** and **Privilege End User**
- Client tools on those machines (or your Mac if used as one persona): SSH, Windows App (RDP), MySQL client, PostgreSQL client, kubectl, AWS CLI, GCloud CLI, Azure CLI, Git (agent install includes Git)

**Available today:** Agent-based Admin and End User  
**Coming soon:** SSO / agentless Admin and End User

AWS target configuration is already done for you (Demo Engineering videos). GCP TBD. AIC WF → Privilege (HRLite hire / provision / certify) is coming.

## Accounts and environments

Replace `{seemail}` with your prefix (example: `david.lee`).

| Role | Username | Environment |
|------|----------|-------------|
| Platform Admin | `{seemail}+p1privilege@pingone.com` | [Admin](https://console.pingone.com/?env=88d79a9c-0dfe-4817-97aa-905bad9ca502) |
| Privilege Admin | `{seemail}+AgentAdmin@pingone.com` | [Agent](https://console.pingone.com/?env=a32ebaed-d454-4f5a-9575-697cfcb6f822) |
| Privilege End User | `{seemail}+AgentEndUser@pingone.com` | Same Agent env |

**Groups (already created):** `AgentPrivilege` (app access), `Approver` (approve in User view). Dynamic groups were not supported as of 2026-06-01 — members must be static.

---

## Steps

### 1. Reset Platform Admin password

1. Open a **new Chrome profile**.
2. Open the [Admin environment](https://console.pingone.com/?env=88d79a9c-0dfe-4817-97aa-905bad9ca502).
3. Click **Forgot Password**.
4. Enter `{seemail}+p1privilege@pingone.com` → **Submit**.
5. From email, paste the recovery code, set a memorable password → **Save**.

### 2. Enroll MFA for Platform Admin

1. When prompted, **Begin MFA Enrollment**.
2. Prefer **email** MFA if you switch browsers often (passkeys stay on one profile).

### 3. Open the Agent environment

1. Open [Agent environment](https://console.pingone.com/?env=a32ebaed-d454-4f5a-9575-697cfcb6f822) (or Manage it from Admin).
2. Confirm **Services → Privilege** is present (Agent mode — onboard via onboarding links).

### 4. Grant Privilege Administrator to AgentAdmin

1. As Platform Admin in the Agent env, open user `{seemail}+AgentAdmin@pingone.com`.
2. **Grant Roles** → **PingOne Privilege Administrator** on the Agent environment.

Without this role, AgentAdmin only sees User view.

### 5. Generate onboarding links

For `{seemail}+AgentAdmin@pingone.com`, then `{seemail}+AgentEndUser@pingone.com`:

1. **Services → Privilege → Generate Onboarding Link**.
2. Copy the link and open it **on the VM for that persona**.
3. Do **not** open Privilege in the browser until the agent is installed.

An install email is also sent. MDM offline generation is roadmap.

### 6. Install the Privilege Agent (each VM)

1. Choose **Download for Windows** or **Download for Apple macOS (Arm64)**.
2. Install (elevate to Administrator on Windows).
3. Wait until status shows Connecting and Key Store is **Key Ring** (Windows) or **Secure Enclave** (Mac).
4. In the browser: **Launch Agent** → **Always Allow** → **Open** (do not press Return — that cancels).
5. Confirm **User Onboarded Successfully**.

Open Console from the tray icon when Connected. Switch Admin ↔ User view in the top right when the Privilege Administrator role is present.

### 7. MFA for AgentAdmin and AgentEndUser

For each persona (as Platform Admin in Agent env):

1. **Users** → user → **Reset Password** (show and copy).
2. Self Service URL for the Agent env → sign in with the temp password → change password.
3. **Authentication → Add Method → PingID Mobile App** → scan QR.
4. Optional PingID labels: Issuer `BXShared`, Account Name `BX`.

### 8. Sync clocks and snapshot

1. On each VM: Adjust date and time → **Sync now** (skewed clocks break demos).
2. Shut down → take a snapshot with a clear description.
3. After boot, start **PingOne Privilege** from the desktop before presenting.

---

## After setup

Use **`/privilege-demo`** → **Script** for the AWS AppRole, four-eyes approve, S3, VPC bundle, kill switch / sudo, and optional Kubernetes acts.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Sessions fail oddly | Sync VM clock |
| No Admin view | Missing Privilege Administrator role on AgentAdmin |
| Launch cancels | Mouse-click Open; Enter selects Cancel |
| Passkey missing elsewhere | Same Chrome profile |
| Policy gone after approve | Do not click Close after creating auto-approve policy |

## Source

Adapted from Demo Engineering **SE1 — Privilege Shared Demo** (shared MT, agent-based personas).
