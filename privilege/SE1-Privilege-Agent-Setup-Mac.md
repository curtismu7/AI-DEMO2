# PingOne Privilege Agent Setup — Mac (Shared SE Demo)

Agent-based persona onboarding for the shared Demo Engineering Privilege environment, run on **your own Mac** instead of Windows 11 VMs.

**Scope:** the Privilege **Agent** only — the device-bound desktop app that pairs a user to a workstation. For the current Agent-authenticated MCP deployment, URLs, and client rules, read [AGENT-CONFIGURATION.md](AGENT-CONFIGURATION.md). Historical gateway work lives in [PRIVILEGE-MCP.md](PRIVILEGE-MCP.md).

Companion doc: [SE1-Privilege-Shared-Demo.md](SE1-Privilege-Shared-Demo.md) covers the same shared demo with VM personas plus the demo script. Read that one for the demo acts; read this one for Mac onboarding.

## Accounts and environments

Replace `{seemail}` with your prefix (example: `curtis.muir`).

| Role | Username | Environment |
|------|----------|-------------|
| Platform Admin | `{seemail}+p1privilege@pingone.com` | [Administrators](https://console.pingone.com/?env=88d79a9c-0dfe-4817-97aa-905bad9ca502) — `88d79a9c-0dfe-4817-97aa-905bad9ca502` |
| Privilege Admin persona | `{seemail}+AgentAdmin@pingone.com` | [Agent](https://console.pingone.com/?env=a32ebaed-d454-4f5a-9575-697cfcb6f822) — `a32ebaed-d454-4f5a-9575-697cfcb6f822` |
| Privilege End User persona | `{seemail}+AgentEndUser@pingone.com` | Same Agent environment |

Both persona users already exist. Groups already exist too:

| Group | Grants |
|-------|--------|
| `AgentPrivilege` | Access to the PingOne Privilege application (Admin or User view) |
| `Approver` | Approve requests in the User view |

Membership must be **static** — dynamic groups were unsupported as of 2026-06-01. Anyone in the application's Access list syncs to Privilege over Kafka.

## Prerequisites on the Mac

- Apple Silicon (Arm64) Mac — the agent download is Arm64
- A dedicated Chrome profile: MFA passkeys bind to the profile, and losing the profile loses the factor
- Target-resource client tools, installed as you need them: SSH, Windows App (RDP), MySQL client, PostgreSQL client, `kubectl`, AWS CLI, gcloud CLI, Azure CLI. Git ships with the agent install. MCP clients TBD.
- Correct system clock. Skewed clocks break Privilege sessions in ways that do not name the clock.

## Two personas, one Mac

The PDF assumes one machine per persona. The agent stores its identity in the **Secure Enclave** and pairs one user to one device, so running AgentAdmin and AgentEndUser side by side on a single Mac is **not something this doc has verified**. Onboard one persona first, confirm it, then attempt the second and watch whether the first stays paired.

Fallbacks if a single Mac cannot hold both: a second Mac, a second macOS user account, or the Windows 11 VM path in the companion doc.

## Check the existing pairing first

The agent may already be installed and paired to a different tenant — several of these environments have been used from the same Mac. Read the current state before generating any onboarding link.

From the shell:

```bash
ls -d "/Applications/PingOne Privilege.app"
defaults read "/Applications/PingOne Privilege.app/Contents/Info.plist" CFBundleShortVersionString
pgrep -fli privilege        # expect cyonagent_mac and enclave
open -a "PingOne Privilege" # foreground the window
```

Then read the agent's **General** panel. `~/Library/Application Support/procyon-agent/config.json` will not answer this — it carries only `controllerURL`, `version`, `homepath`. The pairing itself lives in the Secure Enclave and is not readable from disk, the keychain dump, or any file.

| Tenant ID shown | What it means | Do |
|---|---|---|
| `a32ebaed-d454-4f5a-9575-697cfcb6f822` | Already paired to the shared demo Agent environment | Skip install and pairing. Go to step 7 (MFA) and the demo script |
| Any other tenant | Paired elsewhere — the agent holds one tenant at a time | Re-pair: full steps below |
| App absent, or no `cyonagent_mac` process | Not installed or not running | Full steps below |

**Order matters when re-pairing.** Do not disconnect the current pairing until you hold a valid onboarding link. Links are one-time use and expire in about 2 hours, so disconnecting first can leave the agent unpaired with nothing to pair to. Generate the link, then disconnect (broken-chain icon, bottom left of the agent window), then run the link.

**What re-pairing costs.** The previous tenant's device identity is gone. Recovering it means generating a fresh onboarding link in *that* tenant, which needs console access there. Confirm you still have it before clearing a pairing you may want back.

Observed on this Mac, 2026-08-18 — the case this section exists for:

```text
App Version   2.0.47
Key Store     SecureEnclave
Connected     proxy-us-west-2.privilege.pingone.com:443
Tenant Name   AI-Reference-Demo
Tenant ID     5f4badd1-7d97-48e9-84aa-9f15d72ad84f
MFA Enabled   Disabled
```

Wrong tenant for the shared demo, so a re-pair was required. `MFA Enabled: Disabled` is what step 7 fixes.

## Steps

### 1. Claim the Platform Admin account

1. Open a new Chrome profile.
2. Open the [Administrators environment](https://console.pingone.com/?env=88d79a9c-0dfe-4817-97aa-905bad9ca502).
3. **Forgot Password** → enter `{seemail}+p1privilege@pingone.com` → **Submit**.
4. Copy the reset code from the PingOne email, set a password you will remember → **Save**.
5. At **Begin MFA Enrollment** → **Continue**. Email is the safest factor if you move between browsers; a passkey stays on one profile.

### 2. Open the Agent environment

Go to the [Agent environment](https://console.pingone.com/?env=a32ebaed-d454-4f5a-9575-697cfcb6f822), or Manage it from the Administrators environment. Confirm **PingOne Privilege** appears under Services.

### 3. Grant the admin role

Directory > Users > `{seemail}+AgentAdmin@pingone.com` > **Roles** > **Grant Roles** > **PingOne Privilege Administrator**, scoped to the Agent environment.

Without that role the user lands on the User view with no way to switch to Admin.

Confirm both persona users' group membership while you are here: AgentAdmin in `AgentPrivilege`; AgentEndUser in `AgentPrivilege` **and** `Approver`.

### 4. Generate the onboarding link

Directory > Users > the persona user > **Services** > **Privilege** > **Generate Onboarding Link**.

- One-time use, expires in about 2 hours
- The user also receives it by email
- Open it on the machine that will run that persona — your Mac
- MDM install (JAMF, Intune) and offline generation are roadmap, not available

### 5. Install and pair the agent

Order matters here.

1. Open the onboarding link in the browser. **Do not click Open PingOne Privilege yet.**
2. Click **Download for Apple MacOs (Arm64) Now**.
3. Install the app and launch it. The General panel shows Connection Status **Connecting**, Key Store **Secure Enclave**.
4. Return to the browser and click **Launch Agent**.
5. On the "This site is trying to open PingOne Privilege" dialog, tick **Always allow** and **click Open with the mouse** — pressing Return picks Cancel.
6. Wait for **User Onboarded Successfully** → **Return**.

### 6. Verify the pairing

The agent's General panel should read:

| Field | Expected |
|-------|----------|
| Connection Status | Connected |
| Proxy | `proxy-us-west-2.privilege.pingone.com:443` |
| Connected To | `https://privilege.pingone.com/` |
| Key Store | Secure Enclave |
| Tenant Name | Agent |
| Tenant ID | `a32ebaed-d454-4f5a-9575-697cfcb6f822` |

Then open the Privilege console from the menu-bar Ping icon > **Open Console**. Top right shows the identity and view, `Admin@Agent`. The account menu offers **Switch to user**; that switch only exists when the Privilege Administrator role is present. Bottom-left icon expands the left nav.

### 7. Enrol PingID MFA for each persona

Step-up MFA on sudo is expected around Q3 2026; enrol now so the personas are ready.

As Platform Admin in the Agent environment, for each of AgentAdmin and AgentEndUser:

1. Directory > Users > the user > **Reset Password** > **Create or generate password** — reveal and copy it > **Save**.
2. In a separate browser or incognito window, open the Agent environment's **Self Service URL** (Settings > Environment Properties > URLs).
3. Sign in with the generated password, then change it.
4. **Authentication** > **Add Method** > **PingID Mobile Application** > scan the QR with PingID.
5. Optional labels in PingID: Issuer `BXShared`, Account Name `BX`.

Known oddity from the source doc, unresolved: the two persona users appeared to share the same authenticator entry.

## Skipped on purpose

VM-specific steps in the source PDF do not apply here: Windows installer and UAC elevation, Key Ring key store, Windows date-and-time sync, VM shutdown and snapshot, and restarting PingOne Privilege from the Windows desktop after boot. On a Mac the agent is a normal login-time app; there is no snapshot to revert to, so re-onboarding means a fresh onboarding link.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Onboarding link does nothing / app never pairs | Agent installed and running before clicking Launch Agent? The link is one-time use — generate a new one |
| Dialog cancels itself | Return selects Cancel. Click Open with the mouse |
| No Admin view, only User | AgentAdmin missing the PingOne Privilege Administrator role on the Agent environment |
| User cannot reach Privilege at all | Not a static member of `AgentPrivilege`, or the group is missing from the application's Access list |
| Sessions fail for no stated reason | Mac clock drift |
| Passkey missing after switching browsers | Factor bound to the other Chrome profile. Prefer email MFA |
| Second persona unpairs the first | Expected risk of two identities on one Secure Enclave — see "Two personas, one Mac" |

## Source

Demo Engineering **Privilege Shared Demo** (shared multi-tenant environment, agent-based personas), Mac-only extraction. Environment IDs above are normalized from the source document, where the hyphenation was mangled.
