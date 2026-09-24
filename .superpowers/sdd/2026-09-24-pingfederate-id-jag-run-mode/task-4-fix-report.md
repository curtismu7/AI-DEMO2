# Task 4 review fix — Mission Control and agent launchers

## Review findings addressed

- Both UC40 Mission Control rows now show supporting text inside the action: "Signs out your current session silently, then opens PingFederate login." The text is visible without a tooltip and uses the existing theme text token.
- `useIdJagAgentLauncher` owns the sensitive phrase match, UC40 Demo Steps launch, one-shot validated callback replay, and handoff guard cleanup. `AIAgent` reads its active use case from `useUseCaseRunContext`; `AIAgentFull` reads the existing session-stored context. Those context adapters are explicit at their call sites.
- `AIAgentFull.smoke` now checks a stored-context phrase launch and duplicate validated callback. Regular agent ordinary-path tests now assert that unscoped `show my balance` and `run demo` reach `/api/demo-agent/nl` without an ID-JAG launch.

## Verification

- Red phase: Mission Control copy assertions failed in both UC40 rows before implementation. The other existing and new tests passed.
- Focused Vitest after implementation: **4 files, 135 tests passed** (`DemoStepsDropdown`, `AIAgent.chips`, `AIAgentFull.smoke`, `AIAgent.publicUseCase`).
- `cd demo_api_ui && npm run build`: exit 0, built in 5.16 seconds.
- `git diff --check`: exit 0.

## Boundary

This fix only changes Mission Control and agent launch/replay behavior. It does not implement the Task 6 pending-intent POST, logout, PingFederate login, or callback producer. No live browser handoff is claimed by these tests.
