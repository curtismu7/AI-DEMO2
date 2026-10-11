# SE onboarding email — AI demo + Privilege console + desktop agent

**To:** matthewpollicove@pingidentity.com; cmuir@pingone.com
**Send from:** your mail client (this is a draft, not an automated send)

**Before sending, do these two 2-minute console actions** (only you hold
admin on tenant `0428ba4f` — the invites originate from the console, which
emails the invite links automatically):

1. **PingOne invite (tenant 0428ba4f-169c-436b-aff9-b230496e0e3b):**
   Console → Users → **Invite User** → `matthewpollicove@pingidentity.com`,
   then again for `cmuir@pingone.com`.
2. **Role grant (repeat for each user once accepted):** Platform Admin →
   the user → **Grant Roles** → **PingOne Privilege Administrator**.
   Without this role the console shows only User view (the gap documented
   in `privilege/RUNNING-OUR-DEMO-ON-THE-SHARED-ENV.md`).
3. **Privilege identity sync:** the user must appear in Privilege before
   any Agentic-App policy matches — check the Privilege app's **Group
   Membership Policy** covers the group you put them in, or their actions
   will 403 with `user not found in system` (`privilege/LESSONS-LEARNED.md`).

---

## The email draft

**Subject: AI demo access — PingOne Privilege console, desktop agent, GitHub**

Hi Matthew,

You've been invited to the AI demo stack. Three things to set up; none
should take more than 15 minutes total.

**1. Accept the PingOne invite (check your inbox)**

You'll see an invite from PingOne for the tenant
`0428ba4f-169c-436b-aff9-b230496e0e3b`. Accept it, set up your password and
MFA (MFA is profile-bound — use a consistent browser profile).

Once accepted, Curtis will grant you the **PingOne Privilege Administrator**
role — you'll get console access at:
https://console.pingone.com/?env=0428ba4f-169c-436b-aff9-b230496e0e3b

That's where the AI Gateway, Agentic Apps, and Agent Registry live for the
demo. If the top-right of the console only shows "User view", the role
grant hasn't landed yet — ping Curtis.

**2. Install the desktop Privilege Agent (macOS)**

The agent pairs your machine with the tenant so you can see governed
agent traffic on your own desktop:

1. Sign in to the console (link above).
2. Go to the **Agent Privilege / Desktop Agents** area and click
   **Download for Apple macOS (Arm64)** (the installer is tenant-linked —
   always download from this console rather than a shared file).
3. Install and open it. Wait until the tray icon shows **Connecting →
   Connected** and the Key Store shows **Secure Enclave**.
4. Back in the browser: **Launch Agent** → **Always Allow** → **Open**
   (press the Open button, don't hit Return — that cancels the dialog).
5. Confirm **User Onboarded Successfully**.

Reference docs (Drive): *PingOne Privilege — SE & Architecture Docs*
folder → `privilege-sensor-docker-guide.pdf` and
`privilege-gateway-registering-an-mcp-server.pdf` cover the sensor and
gateway sides if you want the full picture.

**3. GitHub — get the demo repo**

1. **Ask Curtis to add you to GitHub** (`cmuir@pingone.com` /
   `matthewpollicove`) — repo access is grant-by-request while GitHub's
   enterprise policy blocks self-service invites. He'll add you to
   `cmuir_pingcorp/AI-DEMO2` and confirm.
2. Once added: clone and install **OrbStack** (https://orbstack.dev, enable
   Kubernetes in settings) and **Homebrew** (https://brew.sh) if you don't
   have them.
3. Then:

```bash
git clone https://github.com/cmuir_pingcorp/AI-DEMO2 && cd AI-DEMO2
gh auth login                          # once, your Ping GitHub account
./run-pingaws.sh kubeconfig            # SE cluster access
./run-pingaws.sh start                 # your own namespace on the SE cluster
```

Your instance lands at `https://matthewpollicove.ai-demo.ping-devops.com`.
Full install guide (three tiers, troubleshooting):
`docs/runbooks/install-ai-demo.pdf` in the repo.

**Or start here — nothing to install:**
the shared demo is live at **https://ai-demo.ping-devops.com** — sign in
with Ping SSO and explore. The desktop agent + console are for when you
want to show the Privilege side: policies, decisions, recordings.

Questions — ping Curtis.

---

## Maintainer checklist (Curtis — before/after sending)

- [ ] Console: invite `matthewpollicove@pingidentity.com` to tenant 0428ba4f
- [ ] Console: invite `cmuir@pingone.com` to tenant 0428ba4f (full invite:
  invite → accept → grant **PingOne Privilege Administrator** → verify
  Privilege identity sync + group membership so policies match)
- [ ] After acceptance: grant both **PingOne Privilege Administrator**
- [ ] Verify identity syncs into Privilege (no `user not found` on first policy hit)
- [ ] ~~GitHub: add both as read collaborators~~ **BLOCKED (2026-10-11):**
  `cmuir_pingcorp` is an Enterprise Managed User account — the API rejects
  outside collaborators with 422 "Cannot assign permission of read" even
  though the accounts exist. Repo access for non-EMU users needs either an
  org owner to add them as managed members, or moving the repo into an
  org they belong to. Until then: recipients can still use **Tier 1 (the
  shared demo)** with zero GitHub access, or read the repo via a zip
  export you send them.
- [ ] GHCR: grant package Read on the 26 `ai-demo-*` packages (UI: Package
  settings → Manage access) — or point them at Tier 1 (shared demo) which
  needs none of this
