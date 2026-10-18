# Task 5 report
Commit 4cb2efb98 (single commit: panel, modal wiring, CSS, tests).
Changed: CibaLoginPanel.jsx (new), PiFlowSignInModal.jsx (new steps "choice"/"ciba", usePassword(), begin() small branch), App.css (.ciba-login*), tests.
begin(): `choiceFirst = provider !== pingfederate && !mfaRequested()`; choice screen opens NO flow; passkey button = switchToDevice (passwordless=1, both roles; existing 409 fallback handles admin), password link = openFlow without passwordless. PF and ?signin=mfa keep legacy first step (PF gate untouched).
Existing tests: no assertion changed. Every open site (customer/admin, 7 spots + 2 Local helpers) now calls new skipChoice('passkey'|'password') + a microtask flush, since the modal opens on the choice screen and the flow fetch starts on click. Same assertions otherwise.
Tests: CibaLoginPanel 15 + PiFlowSignInModal 64 = 79 pass (npx vitest run both files). Modal-before-change run was 37 red.
Lint (eslint on 4 files): 0 errors; panel clean; modal 1 pre-existing exhaustive-deps warning (begin useCallback, openFlow); test-file warnings pre-existing style, none in new describe.
Doubts: 503 provider_unsupported shows message in panel (not hidden up front; PF already hides button). Match-code expiry fires at exactly expiresIn (no grace). Admin passkey end-to-end unverified live. Single commit rather than split.

## Fix round 1
1. Double-start: startingRef set synchronously at top of start(), cleared in finally. Test fires 3 channel clicks in one act() (no re-render between, so `disabled` cannot help): without the guard "expected 3 to be 1"; with it 1 POST. (Enter twice on identifier step only changes phase; no POST.)
2. act warning in "ignores a second submit while busy": PRE-EXISTING. Base 515c0228f (git archive into /tmp, same test) emits the identical 4 warnings; that test's lines are unchanged (unawaited release() at test end). Left as is.
3. timersRef pruned when each poll timeout fires.
4. Shared chooseAndSettle(kind) helper replaces the 7 copy-pasted skipChoice+flush blocks.
Result: 80/80 pass (CibaLoginPanel 16 + Modal 64); eslint clean on panel + panel test, modal test unchanged (pre-existing warnings only).
