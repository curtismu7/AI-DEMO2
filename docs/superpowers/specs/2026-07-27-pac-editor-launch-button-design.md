# PaC Editor Launch Control — Design Spec

Date: 2026-07-27
Status: implemented

## Problem

`./scripts/pac-edit.sh` starts the Policy-as-Code editor (the jar's Monaco UI over
`pac/policies/`) — edit YAML, live validation, run the policy's tests, visualise
the decision tree, deploy. It is the strongest part of the PaC story, but nothing
in the demo UI mentions it exists. A presenter has to know the script is there and
run it from a terminal, so in practice the feature is invisible to an audience.

## Goal

From the P1AZ Inspector, make it obvious that the editor exists, whether it is
running, and get to it in one click.

## Non-goals

- Starting or stopping the editor from the UI. See "Rejected: BFF spawns the
  editor" below — it cannot work under the project's default Docker startup.
- Embedding the editor in an iframe. It is an unauthenticated deploy-capable
  surface; it stays in its own tab, on the presenter's machine.
- Any change to the editor itself, or to `pac-edit.sh`.

## Design

### Placement

A `Policy as Code` row inside the existing `P1AZ Inspector` panel in
`demo_api_ui/src/components/PingOneAuthorizePage.jsx` (the panel titled at
L486), near the `Evaluate (live)` control. No new page, no new route, no nav
entry.

### Behaviour

| Probe result | Status text | Button |
| --- | --- | --- |
| Reachable | `Running` | `Open editor` enabled → new tab to `http://127.0.0.1:9099` |
| Not reachable | `Not detected` | enabled; panel also shows `./scripts/pac-edit.sh` |

As shipped, this is two states, not three — the link stays **enabled** in the
`Not detected` state too. See the implementation plan's "Deviation from the
spec" section
(`docs/superpowers/plans/2026-07-27-pac-editor-launch-button.md`) for why: a
refused connection and a browser-blocked mixed-content request both surface to
`fetch` as an identical `TypeError`, so a failed probe cannot tell "definitely
stopped" apart from "browser blocked the check" — there is no third,
distinguishable outcome to give its own disabled row.

Probes on mount, and re-probes when the window regains focus — so starting the
editor in a terminal and switching back to the browser updates the status
without a reload. No polling loop: a background timer hitting a local port every
few seconds is noise for a status dot nobody watches continuously.

### Status detection

The demo UI is served over HTTPS (`local.ping-devops.com:4000`); the editor is
plain HTTP on loopback. Two constraints follow:

1. **Mixed content.** Chrome treats `http://127.0.0.1` as potentially
   trustworthy and permits it; Firefox may block it.
2. **No CORS headers.** The editor does not send them, so a normal `fetch` fails
   even when it is running. The probe therefore uses `mode: 'no-cors'` with a
   short timeout (2s). The response is opaque, which is fine: *something
   answered on that port* is the entire signal a status dot needs.

Because both constraints only affect the background probe, a blocked probe
degrades to the `Not detected` state above rather than breaking the feature.
Navigating to `http://127.0.0.1:9099` is a top-level navigation and is never
blocked by either constraint.

**Verified in Chrome**, from `https://local.ping-devops.com:4000`: with the
editor listening, the probe resolves and the control shows `Running`; with it
stopped, `fetch` throws `TypeError` and the control shows `Not detected`. The
mixed-content concern in point 1 above does not materialise in Chrome — this
confirms the design's assumption for the one browser the demo runs in.

The gap, recorded honestly: the *rendered control* was never seen on the live
page. The running demo stack bind-mounts the main checkout, which does not
have this branch's code, so `Running`/`Not detected` was exercised against the
component in isolation, not against `/pingone-authorize` itself. A visual
check on the real page is still needed after this branch merges.

Commit `061ab4370`'s message claims "Manual Chrome verification (brief Step 5)
is pending". That statement is now superseded — the verification described
above was performed, with that result.

### No backend changes

No new BFF route, no Docker image change, no newly exposed port. The browser and
the editor are both on the presenter's host, so they talk directly. This is what
makes the feature work under `./run-docker.sh`.

## Rejected: BFF spawns the editor

The first design had a button that started the editor via a BFF endpoint,
following the `demo_api_server/routes/pingcli.js` precedent (allow-listed
`execFile`/`spawn`), gated local-only and behind a default-OFF `ff_pac_editor`.

It cannot work under the project's default startup (`./run-docker.sh`), verified
against the running stack:

```text
docker exec ai-demo-api-server java -version   → sh: java: not found
pac.jar                                        → /repo/pac/pac.jar (not /app)
```

The BFF image has no JDK. Installing one costs ~300MB and, more importantly,
bakes a deploy-capable unauthenticated editor plus a published port into an image
that also ships to the SE AWS cluster. Even with a JDK, the editor binds
`127.0.0.1` *inside the container*, so the host browser could not reach it
without publishing the port.

Running the BFF natively (`./run.sh`) would allow the spawn, but that is not the
project's normal startup — it hits OrbStack port conflicts — so the button would
show its disabled state most of the time.

## Constraints

- `REGRESSION_PLAN` §0: emoji allowlist only. The status indicator is CSS/text,
  not a coloured-circle emoji.
- Reuse the page's existing `S.*` style objects. No new styling system.
- `PingOneAuthorizePage.jsx` is already 1097 lines. The control goes in its own
  component file rather than growing that file further.

## Testing

Vitest unit test on the new component:

- running → status `Running`, button enabled, correct href
- not detected (probe resolves `unknown`, which covers both "nothing is
  listening" and "the probe was blocked") → status `Not detected`, button
  still enabled, command shown

Manual: with the editor up and down, in Chrome, on `local.ping-devops.com:4000`
— see the verification result recorded under "Status detection" above.

## Files

- `demo_api_ui/src/components/PacEditorLaunch.jsx` (new)
- `demo_api_ui/src/components/__tests__/PacEditorLaunch.test.jsx` (new)
- `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (one row added to the
  P1AZ Inspector panel)
