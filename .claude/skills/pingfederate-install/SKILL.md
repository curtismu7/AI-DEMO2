---
name: pingfederate-install
description: Use when installing, standing up, or first-run configuring PingFederate (zip, Docker/Compose, or Kubernetes) for a demo or SE environment, including licence, ports, Java, admin console setup, and readiness checks. Use before pingfederate-id-jag, which assumes a running PingFederate.
---

# PingFederate install

PingFederate is a standalone product, separate from PingOne, PingGateway and PingAccess. AI-DEMO2 does not ship one by default; treat this as a new, separately named component.

## Workflow

1. Start at `https://docs.pingidentity.com/pingfederate/llms.txt` and open "Installing and Uninstalling PingFederate" for the target release. Confirm the Java version, OS support and port list for that release before installing; they change by version. ID-JAG needs 13.1 or later (see `pingfederate-id-jag`).
2. Choose the deployment model and say which you picked:
   - **Local Docker (default for this repo):** the `pingidentity/pingfederate` image with a devops-style env/profile. Run via OrbStack, never Docker Desktop. Bind-mount nothing from a worktree.
   - **Zip on a host:** install a supported JRE, unzip, place the licence, start with the bundled run script.
   - **Kubernetes:** only when the user names the SE cluster; follow `ping-se-cluster-deploy`. Nodes there are arm64, so use an arm64-capable image.
3. Supply the licence out of band (file mount or secret). It is not in the repo. Keep it and every admin password out of source control, and never print them.
4. Expose only what is needed. The admin console and admin API are on their own port and must not be public; the runtime (engine) port is the one clients and partners reach. Take exact port numbers from the release's port-requirements page.
5. Complete the initial setup wizard (admin account, licence, base URL). The base URL becomes the issuer other systems trust, so set it to the hostname clients will actually use, with a real TLS certificate (mkcert is fine locally).
6. Verify: the admin console loads, the runtime endpoint answers, `/.well-known/openid-configuration` returns the expected issuer, and logs show no licence or keystore errors.

## Boundaries

Do not deploy to `ping-devops-cmuir` or any remote environment unless the user names it. Record any gap you leave (for example a self-signed cert) in `TECH_DEBT.md`.
