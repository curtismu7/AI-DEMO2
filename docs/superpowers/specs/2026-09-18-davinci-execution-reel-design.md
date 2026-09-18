# DaVinci SDK Execution Reel Design

## Goal

Make `/davinci-orchestration-sdk` teach the live execution of a PingOne
DaVinci flow by showing the code boundary, DaVinci response, and collector
state as one synchronized story. Preserve the existing static lessons, make
their code sections collapsible, and ensure live code examples describe the
same operations the page actually executes.

## Audience and teaching job

The primary audience is a developer or identity engineer debugging a custom
DaVinci renderer. They need to answer three questions without opening DevTools:

1. What did the page call?
2. What did DaVinci return and what did the SDK turn it into?
3. Which collector was rendered, updated, or used to advance the flow?

The page must distinguish DaVinci-side state from browser-side collector state;
combining them into a single undifferentiated log would hide the boundary this
lesson is intended to teach.

## Design options considered

### A. Movie reel with synchronized lanes — recommended

The primary surface is a horizontal sequence of frames. Each frame represents
one real milestone: `start()`, the authorize request, DaVinci's `showForm`, a
collector snapshot, a collector update, `next()`/`flow()`, or a terminal
response. Every frame has two lanes:

- **DaVinci:** policy/interaction/request/response/form state.
- **SDK + collectors:** code operation, collector category, rendered control,
  or value update.

The current frame has a playhead. Selecting a frame opens a detail panel with
the copyable code, masked request/response JSON, collector mapping, and a short
explanation. New live events append and select themselves; replay controls only
animate events already captured.

This is the recommendation because sequence is the core concept, while the
two lanes make the system boundary explicit.

### B. Debugger split view

The left pane highlights a current code line, the center pane lists events, and
the right pane shows DaVinci and collector state. This is excellent for a
developer focused on one call, but the vertical log makes a multi-screen flow
harder to scan and gives less room to compare request and response.

### C. Storyboard / decision map

The flow is shown as a selectable graph of screens and API boundaries. A node
opens the same details panel as the reel. This is the strongest architecture
overview, but it is less natural for showing typed input and the exact order of
SDK calls. It remains a possible future view for the existing “The Flow” lesson.

## User experience

### Concept mock

The first implementation includes a clearly labeled **Execution view concepts**
surface using sample data. It has three selectable tabs—Movie reel, Debugger,
and Storyboard—so the visual alternatives can be compared without requiring a
successful live login. The Movie reel is selected by default. Sample content is
visibly marked as a preview and never appears in the live trace or claims to be
from the current browser run. The live reel is a separate mode below the
concept preview, so selecting a concept never replaces or mutates real run data.

### Live execution reel

The live surface replaces the preview data once a real run emits events. Empty
state copy explains that the first frame appears after `start()` begins. Each
frame contains:

- sequence number and elapsed time;
- operation label such as `client.start()`, `client.update()`, or
  `client.next()`;
- DaVinci status such as `showForm`, `continue`, `error`, or completion;
- collector summary, including category and whether it is input, action,
  display-only, or automatic;
- a selected/unselected state and an accessible button name.

The detail panel uses stacked disclosures for **Code**, **Request**,
**DaVinci response**, and **Collectors**. Request bodies show only allowlisted
keys and replace typed values with `…`; authorize URLs show parameter names,
never values. Raw secrets, PKCE values, nonce, state, interaction identifiers,
and authorization codes are never rendered; existing masked placeholders such
as `…` are allowed where the lesson needs to show that a field existed.

### Static lessons

Existing `CodeBlock` content remains. Each code example is wrapped in a
collapsible section with a descriptive button/summary. The first lesson section
also explains that a live frame is evidence from this browser run, while a
static block is a copyable pattern. The lessons add the currently learned P1
Forms and routing rules:

- `response_mode=pi.flow` returns each screen to the SDK instead of navigating
  the browser to a hosted page.
- `acr_values` selects the intended DaVinci policy when two policies are
  assigned to the same application.
- P1 Forms `RichTextCollector` is display-only text, `ERROR_DISPLAY` is a
  page-owned error slot, and `ProtectCollector` is an automatic security
  signal—not a user input.
- collectors are immutable; values must be written with
  `client.update(collector)(value)`.
- `SubmitCollector` uses `client.next()` while `FlowCollector` uses
  `client.flow({ action })()` and does not submit current form data.
- completion returns through the SDK response body and BFF callback exchange;
  the browser does not rely on a hosted redirect screen.

## Event and data design

The existing trace remains the source of transport and SDK state evidence. A
small semantic event adapter joins those entries with the page's operation
boundaries. The normalized event shape is:

```js
{
  id: "execution-12",
  sequence: 12,
  at: 1768780000000,
  lane: "davinci" | "sdk" | "collector",
  kind: "operation.begin" | "request" | "response" | "collectors" |
    "collector.update" | "terminal",
  label: "DaVinci returned showForm",
  codeKey: "start" | "flow" | "update-next" | null,
  detail: { /* masked, display-safe fields only */ }
}
```

The adapter emits events at actual boundaries, not on a timer:

1. operation begins (`start`, `flow`, or `update` + `next`);
2. request middleware records the outgoing request;
3. DaVinci response is read from the SDK cache;
4. collectors are read from `client.getCollectors()`;
5. collector updates are emitted when the page calls the existing updater;
6. terminal success/failure is emitted when the existing node handler decides
   the run is complete.

The reel is a pure renderer over normalized events. The page owns the event
buffer and appends events as callbacks fire, so the live UI cannot invent a
collector or response that did not occur.

## Code truth model

The page already exposes `stepCode`, `requestShape`, `responseShape`, and
masked request helpers. The live reel reuses those functions and the same
operation metadata used by `recordStep`. No code sample is copied into a
second handler. Tests will assert that each displayed operation includes the
actual calls (`client.start`, `client.flow`, `client.update`, `client.next`)
and that the corresponding page path still invokes those calls.

The mock uses the same display components with fixture events. It is therefore
safe to delete or replace the preview data without changing the live event
contract.

## Component boundaries

- `SdkExecutionReel.jsx`: normalized event timeline, lane cards, playhead,
  selection, and detail panel.
- `SdkExecutionReel.css`: theme-aware reel layout, lane styling, responsive
  overflow, selected states, and reduced-motion behavior.
- `sdkExecutionEvents.js`: event normalization and masking adapter helpers;
  exported for unit tests.
- `CollapsibleCodeBlock.jsx` or the existing lesson wrapper: disclosure around
  static code examples without changing the code contents.
- `DavinciSdkLoginPage.jsx`: owns the event buffer and emits semantic events at
  existing operation boundaries.
- `SdkLessonSections.jsx`: adds the lessons learned and uses the collapsible
  code wrapper.

The existing `CollectorField`, `StepInspector`, and BFF authorization flow are
not replaced. The reel consumes their evidence and preserves their current
behavior.

## Accessibility and visual rules

- Frames are real buttons with visible selected/focus states.
- The playhead is supplementary; all information is available in text.
- The detail panel has a labeled region and closes with Escape.
- Motion honors `prefers-reduced-motion`; real-time updates remain visible
  without animated travel.
- Both light and dark themes use existing `--th-*` tokens and the repository's
  contrast auditor requirements.
- No new emoji or unapproved glyphs are introduced.

## Verification

Unit tests will cover:

- normalization of logger, HTTP, state, operation, and collector events;
- secret masking and allowlisted request/response shapes;
- frame selection and detail content;
- preview/live mode separation;
- collapsible static code sections;
- exact operation code strings and collector explanations.

The UI build is required. Playwright will verify the deployed page shows the
preview, starts a real flow, appends live frames, opens a frame detail panel,
and remains readable in both themes. Existing full-suite failures outside the
DaVinci surface will be reported rather than attributed to this feature.

## Non-goals

- No JavaScript engine or source-map debugger is added.
- No raw secret/request logging is introduced.
- No changes to PingOne policy assignment, BFF token exchange, callback
  behavior, or DaVinci flow configuration are needed.
- No replacement of the existing static lesson content with generated prose.
