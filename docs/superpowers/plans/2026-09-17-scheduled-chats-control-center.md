# Scheduled chats control center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn LibreChat’s existing scheduled-chats side panel into a clear control center for pausing, editing, running, and understanding the three unattended demo workflows.

**Architecture:** Extend the pinned LibreChat client through the existing
`apply-persistent-conversation-starters.mjs` image-build patch. Keep the current
`useSchedulesQuery`, `useUpdateScheduleMutation`, and
`useRunScheduleNowMutation` contracts; add presentation and explanation data in
the client patch, and add stop behavior only if the running image exposes a
supported cancellation mutation. Do not add a second schedule store or client
side scheduler.

**Tech Stack:** React, TypeScript, TanStack Query, LibreChat client components,
Tailwind utility classes, Jest/React Testing Library, Docker image build.

**Spec:** `docs/superpowers/specs/scheduled-chats-control-center.md`

## Global Constraints

- Preserve server truth after refresh; optimistic controls must roll back when the API rejects a change.
- Saving updates the existing schedule by ID and must not reset enabled state or last-run metadata.
- Never imply that a successful scheduled run means a transfer completed.
- Show `America/Chicago` explicitly for the seeded schedules.
- Keep seeded agent and prompt fields read-only in the editor.
- Preserve the existing per-user schedule limit and hourly minimum interval.
- Build and test through the pinned LibreChat image; do not introduce a second runtime or unpinned upstream source.
- Use only the project’s emoji allowlist; prefer icons and semantic text.

## File map

- Modify: `librechat/patches/apply-persistent-conversation-starters.mjs` — copy/patch the control-center component and its tests into the pinned image during Docker build.
- Create in image: `/app/client/src/components/SidePanel/Schedules/ScheduleExplanation.tsx` — product-language explanation and outcome mapping for the three seeded workflows.
- Modify in image: `/app/client/src/components/SidePanel/Schedules/ScheduleCard.tsx` — expose status, explanation, explicit actions, and a details affordance while preserving existing mutations.
- Modify in image: `/app/client/src/components/SidePanel/Schedules/SchedulePanel.tsx` — add summary metrics, filter tabs, and selected-schedule detail layout around the existing list.
- Modify in image: `/app/client/src/locales/en/translation.json` — add copy for explanations, controls, confirmation messages, and safe transfer language.
- Create in image: `/app/client/src/components/SidePanel/Schedules/__tests__/ScheduleExplanation.spec.tsx` — assert explanation and outcome wording.
- Create in image: `/app/client/src/components/SidePanel/Schedules/__tests__/SchedulePanel.controlCenter.spec.tsx` — assert list summary, filtering, and control wiring.
- Modify: `librechat/Dockerfile` — only if the patch needs an additional build-time test command; keep the existing pinned build and test sequence.
- Modify: `librechat/README.md` — document where presenters find the controls and the three important run outcomes.

### Task 1: Confirm the upstream contracts and patch seams

**Files:**
- Read: `/app/client/src/components/SidePanel/Schedules/ScheduleCard.tsx`
- Read: `/app/client/src/components/SidePanel/Schedules/SchedulePanel.tsx`
- Read: `/app/client/src/data-provider/Schedules/mutations.ts`
- Modify: `librechat/patches/apply-persistent-conversation-starters.mjs`

**Interfaces:**
- Consumes: the pinned image’s existing schedule component source and mutation names.
- Produces: exact, unique replacement anchors for the implementation patch; the build must fail if upstream moves the target code.

- [ ] **Step 1: Add a patch helper for copying a source file into the image.**

```js
function writePatchedFile(path, source, label) {
  writeFileSync(path, source);
  console.log(`patched ${label}`);
}
```

- [ ] **Step 2: Add exact-match guards for SchedulePanel and ScheduleCard imports/render anchors.**

```js
replaceOnce(schedulePanel, "import ScheduleCard from './ScheduleCard';", "import ScheduleCard from './ScheduleCard';\nimport ScheduleControlCenterHeader from './ScheduleControlCenterHeader';", 'schedule panel import');
```

- [ ] **Step 3: Run the patch script’s existing unit invocation in a disposable image or test fixture and confirm it fails loudly when an anchor is absent.**

Run: `node --check librechat/patches/apply-persistent-conversation-starters.mjs`

Expected: exit 0.

- [ ] **Step 4: Commit the patch-seam change.**

```bash
git add librechat/patches/apply-persistent-conversation-starters.mjs
git commit -m "build(librechat): add schedule control-center patch seams"
```

### Task 2: Add explanation and outcome language

**Files:**
- Create in image: `/app/client/src/components/SidePanel/Schedules/ScheduleExplanation.tsx`
- Modify in image: `/app/client/src/locales/en/translation.json`
- Test in image: `/app/client/src/components/SidePanel/Schedules/__tests__/ScheduleExplanation.spec.tsx`

**Interfaces:**
- Consumes: `TSchedule`, `ScheduleRunStatus`, `ScheduleDisabledReason`, and the resolved agent name.
- Produces: `getScheduleExplanation(schedule): { summary, capability, successMeaning, recovery, tone }` and a semantic explanation component.

- [ ] **Step 1: Write failing tests for all three seeded schedules.**

```tsx
expect(getScheduleExplanation({ name: 'Weekly savings sweep' } as TSchedule)).toMatchObject({
  summary: expect.stringContaining('$750'),
  successMeaning: expect.stringContaining('does not mean money moved'),
});
expect(getScheduleExplanation({ name: 'Daily rentals check' } as TSchedule).recovery)
  .toContain('gateway');
```

- [ ] **Step 2: Run the focused test and verify it fails because the helper is absent.**

Run inside the pinned client: `npm test -- ScheduleExplanation.spec.tsx --runInBand`

Expected: FAIL with the missing helper/module.

- [ ] **Step 3: Implement the small name-based explanation map with a generic fallback.**

```ts
export function getScheduleExplanation(schedule: Pick<TSchedule, 'name'>) {
  return EXPLANATIONS[schedule.name] ?? {
    summary: 'Runs the selected agent with its saved prompt.',
    capability: 'Capabilities depend on the selected agent.',
    successMeaning: 'The scheduled agent run completed.',
    recovery: 'Review the latest run details for next steps.',
    tone: 'neutral' as const,
  };
}
```

- [ ] **Step 4: Add sentence-case translations for status and action copy.**

Required messages include `Success — chat created`,
`Completed with step-up required`, `Needs connection`, `Run now`, `Stop run`,
`Schedule updated`, and `This will attempt a $750 transfer and may ask for
step-up approval.`

- [ ] **Step 5: Run the focused tests and confirm all explanation cases pass.**

Run: `npm test -- ScheduleExplanation.spec.tsx --runInBand`

Expected: all tests pass.

- [ ] **Step 6: Commit the explanation unit.**

```bash
git add librechat/patches/apply-persistent-conversation-starters.mjs
git commit -m "feat(librechat): explain scheduled workflow outcomes"
```

### Task 3: Reshape the schedule panel into the control center

**Files:**
- Create in image: `/app/client/src/components/SidePanel/Schedules/ScheduleControlCenterHeader.tsx`
- Modify in image: `/app/client/src/components/SidePanel/Schedules/SchedulePanel.tsx`
- Modify in image: `/app/client/src/components/SidePanel/Schedules/ScheduleCard.tsx`
- Test in image: `/app/client/src/components/SidePanel/Schedules/__tests__/SchedulePanel.controlCenter.spec.tsx`

**Interfaces:**
- Consumes: `useSchedulesQuery`, existing create/update/run mutations, explanation helper, and existing navigation to run chats.
- Produces: a responsive list/detail control center with stable query invalidation and accessible controls.

- [ ] **Step 1: Write failing tests for the control center.**

```tsx
expect(screen.getByText('3 schedules')).toBeInTheDocument();
expect(screen.getByText('Needs attention')).toBeInTheDocument();
expect(screen.getByText(/success does not mean money moved/i)).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: /pause weekly savings sweep/i }));
expect(mockUpdate).toHaveBeenCalledWith({ id: 'sweep-1', payload: { enabled: false } });
```

- [ ] **Step 2: Run the focused test and verify it fails against the compact upstream panel.**

Run: `npm test -- SchedulePanel.controlCenter.spec.tsx --runInBand`

Expected: FAIL on the missing summary/detail controls.

- [ ] **Step 3: Add the header summary and filter state without changing query ownership.**

```tsx
const schedules = data?.schedules ?? [];
const attentionCount = schedules.filter((schedule) =>
  schedule.lastRun?.status === 'error' || schedule.disabledReason != null,
).length;
```

Keep `useSchedulesQuery` as the sole list source and keep `useRunSync` active.

- [ ] **Step 4: Update ScheduleCard with plain-language explanation, explicit status, and controls.**

Keep `useUpdateScheduleMutation` for enable/pause and `useRunScheduleNowMutation`
for one-off runs. Add a confirmation step before running the savings sweep.
Preserve the existing edit dialog and delete behavior in the technical-options
menu. Link successful run chips to the stored conversation ID.

- [ ] **Step 5: Add details selection and responsive layout.**

The selected schedule panel must show explanation, editable time/day/timezone,
last-run interpretation, agent, and exact prompt. On narrow screens it moves
below the list; on wide screens it remains a sticky details column.

- [ ] **Step 6: Implement stop behavior only if a supported server mutation exists.**

First inspect the exported data-service methods and route contract. If there is
no cancellation endpoint, show in-flight status and pause future cadence runs;
do not fabricate `POST /stop`. Record this as an explicit follow-up in the UI
copy and plan rather than pretending cancellation is supported.

- [ ] **Step 7: Run the focused panel/card/dialog tests and confirm they pass.**

Run: `npm test -- SchedulePanel.controlCenter.spec.tsx ScheduleExplanation.spec.tsx ScheduleDialog.spec.tsx --runInBand`

Expected: all focused suites pass.

- [ ] **Step 8: Commit the control-center unit.**

```bash
git add librechat/patches/apply-persistent-conversation-starters.mjs
git commit -m "feat(librechat): add scheduled chats control center"
```

### Task 4: Build, run, and validate the patched image

**Files:**
- Modify: `librechat/Dockerfile` only if the new tests need an explicit command.
- Modify: `librechat/README.md`

**Interfaces:**
- Consumes: the patched image and existing local Mongo schedule records.
- Produces: a buildable image and presenter-facing setup notes.

- [ ] **Step 1: Update README usage notes.**

Document the control-center location, how pause/resume differs from `Run now`,
the gateway connection prerequisite, and that the savings transfer requires
step-up approval.

- [ ] **Step 2: Build the pinned LibreChat image.**

Run: `docker compose -f librechat/docker-compose.yml build api`

Expected: the patch script applies, client tests pass, and the client build exits 0.

- [ ] **Step 3: Restart only the standalone LibreChat service as required by the image build.**

Run: `docker compose -f librechat/docker-compose.yml up -d api oauth-loopback`

Expected: `librechat` and `librechat-oauth-loopback` are running; the root demo
stack is not recreated.

- [ ] **Step 4: Verify live schedule invariants after the restart.**

Run the documented seed flow twice, then query Mongo and assert:

```text
exactly three named schedules
stable IDs across both reseeds
enabled state preserved
America/Chicago preserved
morning and sweep lastRun conversation IDs preserved
rentals mcp_reauth_required explanation preserved
```

- [ ] **Step 5: Perform a browser smoke test.**

Open Scheduled chats, select each schedule, toggle pause/resume, edit a time,
save, open details, and use `Run now` on the read-only morning report. Confirm
the toast and persisted state after refresh. Do not enable the live schedules
without presenter approval.

- [ ] **Step 6: Run final checks before claiming completion.**

Run: `node --check librechat/patches/apply-persistent-conversation-starters.mjs`

Run: `git diff --check`

Run: `git status --short --branch`

Expected: syntax and whitespace checks pass; only intended files are changed.

- [ ] **Step 7: Commit the documentation and final build result.**

```bash
git add librechat/README.md librechat/Dockerfile
git commit -m "docs(librechat): document scheduled chat controls"
```

## Plan self-review

- Spec coverage: controls, time editing, explanations, status semantics,
  gateway recovery, seeded schedule limits, responsive layout, accessibility,
  and reseed stability are covered by Tasks 2–4.
- Cancellation gap is explicit: Task 3 checks the real API before adding a
  stop button, preventing a UI control with no server behavior.
- No placeholders or undefined implementation names remain.
- The plan modifies the existing pinned-image patch path and does not create a
  parallel scheduling system.
