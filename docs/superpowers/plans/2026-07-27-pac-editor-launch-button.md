# PaC Editor Launch Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Policy-as-Code editor from the P1AZ Inspector — show whether it is running and open it in one click.

**Architecture:** Pure frontend. A probe helper asks whether anything is listening on `http://127.0.0.1:9099`, and a small component renders that status plus a link. The browser and the editor both run on the presenter's host, so they talk directly — no BFF route, no Docker image change, no newly exposed port. Mounted into the existing `InspectorShell` `actions` slot on `PingOneAuthorizePage`.

**Tech Stack:** React 19, Vite 8, vitest + @testing-library/react (jsdom, `globals: true`, setup at `demo_api_ui/src/setupTests.js`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-pac-editor-launch-button-design.md`
- `REGRESSION_PLAN` §0 — emoji allowlist is `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only. Status indicators here are plain text; do not add a coloured-circle emoji.
- No new BFF route, no Docker image change, no new exposed port.
- `PingOneAuthorizePage.jsx` is 1097 lines. New code goes in new files; the page gets one added prop only.
- The editor is unauthenticated and can deploy to live PingOne. Open it in a new tab — never an iframe.
- Editor URL is `http://127.0.0.1:9099` (the `pac-edit.sh` default). Start command is `./scripts/pac-edit.sh`.

## Deviation from the spec (read before Task 1)

The spec's table has three probe outcomes: `Running`, `Not running` (button
disabled), and `Unknown` (button enabled). **That distinction is not
implementable.** A refused connection and a browser-blocked mixed-content
request both surface to `fetch` as an identical `TypeError` — the browser
deliberately withholds the difference so pages cannot port-scan localhost.

So this plan implements two outcomes, `running` and `unknown`, and the button
is **always enabled**. Disabling on a failed probe would disable the button in
any browser that blocks the probe while the editor is in fact running — the
exact false negative the spec's `Unknown` row exists to avoid.

Two smaller departures, both deliberate:

- **Placement.** The spec put the control "near the `Evaluate (live)` control".
  It goes in `InspectorShell`'s `actions` slot instead — the shell's own
  top-right slot for exactly this, already rendered at
  `shared/InspectorShell.jsx:133`. Same panel, idiomatic mounting, and it keeps
  the change to `PingOneAuthorizePage.jsx` down to one prop.
- **File count.** The spec listed one new component. This plan splits the probe
  into `pacEditorStatus.js` so the network behaviour is testable without
  rendering, leaving the component to render state it is handed.

---

### Task 1: Probe helper

**Files:**

- Create: `demo_api_ui/src/components/pacEditorStatus.js`
- Test: `demo_api_ui/src/components/__tests__/pacEditorStatus.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `PAC_EDITOR_URL: string` — `'http://127.0.0.1:9099'`
  - `PAC_EDITOR_COMMAND: string` — `'./scripts/pac-edit.sh'`
  - `probePacEditor(fetchImpl?: typeof fetch, timeoutMs?: number): Promise<'running' | 'unknown'>`

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/pacEditorStatus.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import {
  PAC_EDITOR_URL,
  PAC_EDITOR_COMMAND,
  probePacEditor,
} from '../pacEditorStatus';

describe('pacEditorStatus', () => {
  it('points at the pac-edit.sh default port on loopback', () => {
    expect(PAC_EDITOR_URL).toBe('http://127.0.0.1:9099');
    expect(PAC_EDITOR_COMMAND).toBe('./scripts/pac-edit.sh');
  });

  it('reports running when something answers on the port', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' });
    await expect(probePacEditor(fetchImpl)).resolves.toBe('running');
  });

  it('sends an opaque no-cors request (the editor sets no CORS headers)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' });
    await probePacEditor(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      PAC_EDITOR_URL,
      expect.objectContaining({ mode: 'no-cors' }),
    );
  });

  it('reports unknown when the request fails, since refused and blocked are indistinguishable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(probePacEditor(fetchImpl)).resolves.toBe('unknown');
  });

  it('reports unknown when the probe times out', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(probePacEditor(fetchImpl, 5)).resolves.toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/pacEditorStatus.test.js`
Expected: FAIL — `Failed to resolve import "../pacEditorStatus"`

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_ui/src/components/pacEditorStatus.js`:

```js
// Status probe for the local Policy-as-Code editor (scripts/pac-edit.sh).
//
// The demo UI is served over HTTPS and the editor is plain HTTP on loopback, so
// this is a mixed-content request. It is also cross-origin against a server that
// sends no CORS headers. Hence mode: 'no-cors' — the response is opaque and
// unreadable, but the fact that it resolved proves something is listening, which
// is the whole signal a status indicator needs.
//
// A refused connection and a browser-blocked request are BOTH a plain TypeError;
// browsers withhold the difference so pages cannot port-scan localhost. So a
// failed probe means "not detected", never "definitely not running".

export const PAC_EDITOR_URL = 'http://127.0.0.1:9099';
export const PAC_EDITOR_COMMAND = './scripts/pac-edit.sh';

export async function probePacEditor(fetchImpl = fetch, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(PAC_EDITOR_URL, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return 'running';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/pacEditorStatus.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/pacEditorStatus.js demo_api_ui/src/components/__tests__/pacEditorStatus.test.js
git commit -m "feat(p1az): probe helper for the local PaC editor"
```

---

### Task 2: Launch control component

**Files:**

- Create: `demo_api_ui/src/components/PacEditorLaunch.jsx`
- Test: `demo_api_ui/src/components/__tests__/PacEditorLaunch.test.jsx`

**Interfaces:**

- Consumes: `PAC_EDITOR_URL`, `PAC_EDITOR_COMMAND`, `probePacEditor` from Task 1.
- Produces: default export `PacEditorLaunch({ probe?: () => Promise<'running' | 'unknown'> })`. The `probe` prop exists so tests can inject; production callers pass nothing.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/PacEditorLaunch.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import PacEditorLaunch from '../PacEditorLaunch';

describe('PacEditorLaunch', () => {
  it('shows Running when the editor answers', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('running')} />);
    expect(await screen.findByText('Policy editor: Running')).toBeTruthy();
  });

  it('links to the editor on loopback, in a new tab, without opener access', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('running')} />);
    const link = await screen.findByRole('link', { name: /open editor/i });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:9099');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the start command when the editor is not detected', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('unknown')} />);
    expect(await screen.findByText('Policy editor: Not detected')).toBeTruthy();
    expect(screen.getByText('./scripts/pac-edit.sh')).toBeTruthy();
  });

  it('keeps the link usable when not detected, because a blocked probe looks identical to a refused one', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('unknown')} />);
    const link = await screen.findByRole('link', { name: /open editor/i });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:9099');
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('re-probes when the window regains focus', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('running');
    render(<PacEditorLaunch probe={probe} />);
    expect(await screen.findByText('Policy editor: Not detected')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByText('Policy editor: Running')).toBeTruthy();
    });
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PacEditorLaunch.test.jsx`
Expected: FAIL — `Failed to resolve import "../PacEditorLaunch"`

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_ui/src/components/PacEditorLaunch.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAC_EDITOR_URL,
  PAC_EDITOR_COMMAND,
  probePacEditor,
} from './pacEditorStatus';

const S = {
  wrap: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 },
  status: { color: '#475569', whiteSpace: 'nowrap' },
  dot: (on) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 6,
    background: on ? '#16a34a' : '#94a3b8',
  }),
  hint: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    padding: '2px 6px',
    color: '#334155',
    whiteSpace: 'nowrap',
  },
  link: {
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '4px 10px',
    color: '#0f172a',
    background: '#fff',
    whiteSpace: 'nowrap',
  },
};

// Status + launcher for the local Policy-as-Code editor.
//
// The link is always enabled. A failed probe cannot distinguish "nothing is
// listening" from "this browser blocked the mixed-content request", so
// disabling on failure would block a working editor in browsers that block the
// probe. Better to let the click through and let the new tab tell the truth.
export default function PacEditorLaunch({ probe = probePacEditor }) {
  const [status, setStatus] = useState('unknown');
  const aliveRef = useRef(true);

  const check = useCallback(() => {
    Promise.resolve(probe()).then((next) => {
      if (aliveRef.current) setStatus(next);
    });
  }, [probe]);

  useEffect(() => {
    aliveRef.current = true;
    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  const running = status === 'running';

  return (
    <div style={S.wrap}>
      <span style={S.status}>
        <span style={S.dot(running)} />
        {`Policy editor: ${running ? 'Running' : 'Not detected'}`}
      </span>
      {!running && <code style={S.hint}>{PAC_EDITOR_COMMAND}</code>}
      <a
        style={S.link}
        href={PAC_EDITOR_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open editor
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PacEditorLaunch.test.jsx`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/PacEditorLaunch.jsx demo_api_ui/src/components/__tests__/PacEditorLaunch.test.jsx
git commit -m "feat(p1az): PaC editor status and launch control"
```

---

### Task 3: Mount into the P1AZ Inspector

**Files:**

- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (import near L11; `InspectorShell` opening tag near L486)

**Interfaces:**

- Consumes: `PacEditorLaunch` default export from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the actions slot is free**

Run: `cd demo_api_ui && grep -n "actions=" src/components/PingOneAuthorizePage.jsx`
Expected: no output. `InspectorShell` accepts `actions` (rendered into `.inspector-shell-topbar__right` at `src/components/shared/InspectorShell.jsx:133`) and this page does not use it yet.

If that grep DOES return a line, stop and report — the plan assumed the slot was free, and overwriting an existing `actions` would drop whatever it renders.

- [ ] **Step 2: Add the import**

In `demo_api_ui/src/components/PingOneAuthorizePage.jsx`, directly below the existing line 11 `import InspectorShell from './shared/InspectorShell';`, add:

```jsx
import PacEditorLaunch from './PacEditorLaunch';
```

- [ ] **Step 3: Pass the control into the shell**

Find this opening tag (near L486):

```jsx
    <InspectorShell
      title="P1AZ Inspector"
      statusOn={!!endpointId}
```

Add the `actions` prop immediately after `title`:

```jsx
    <InspectorShell
      title="P1AZ Inspector"
      actions={<PacEditorLaunch />}
      statusOn={!!endpointId}
```

- [ ] **Step 4: Run the UI unit suite and the build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both pass. The build gate is required by `CLAUDE.md` before claiming UI work is done.

- [ ] **Step 5: Manual verification in Chrome**

The probe's real-world behaviour is the one thing unit tests cannot prove — jsdom does not enforce mixed-content rules.

1. `./scripts/pac-edit.sh` in a terminal.
2. Open `https://local.ping-devops.com:4000/pingone-authorize` in Chrome.
3. Expect `Policy editor: Running`, green dot, no command hint.
4. Click `Open editor` — new tab loads the Monaco editor.
5. Stop the editor (Ctrl+C), return to the tab, click away and back to refocus the window.
6. Expect `Policy editor: Not detected` and the `./scripts/pac-edit.sh` hint.

Record the outcome in the commit message. If step 3 shows `Not detected` while the editor is running, Chrome is blocking the probe — the link still works, so note it as a known limitation rather than a blocker.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/PingOneAuthorizePage.jsx
git commit -m "feat(p1az): surface the PaC editor from the P1AZ Inspector"
```

---

## Done when

- `cd demo_api_ui && npm run test:unit && npm run build` passes.
- The P1AZ Inspector shows editor status and opens the editor in a new tab.
- No BFF route, Docker image, or exposed port changed.
