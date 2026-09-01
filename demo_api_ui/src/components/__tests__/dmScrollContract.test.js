import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DraggableModal renders `<div className="dm-body">{children}</div>`. `.dm-body`
 * has NO padding and `overflow: hidden`; the `padding: 16px 20px` and the scroll
 * both live on `.dm-scroll`, which callers must add themselves.
 *
 * Miss it and the copy sits flush against the panel edge and long content clips
 * instead of scrolling — it reads as "the text is not formatted", and grepping
 * the stylesheet proves nothing because the component's own classes are all
 * present and correct. Eight of 41 callers had this bug at once (PRs #2645,
 * #2653), which is why the contract is now written down instead of remembered.
 *
 * This is a heuristic, not a parser. It only asks whether a caller file mentions
 * `dm-scroll` at all, so it cannot catch a wrapper placed on the wrong element —
 * what it DOES catch is the case that actually happened: a new modal with no
 * wrapper anywhere. A caller that legitimately wants a bare, full-bleed body
 * names itself in FULL_BLEED below, which turns an invisible omission into a
 * one-line decision someone had to write down.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Callers whose body is deliberately NOT wrapped: surfaces that own their own
 * background and fill the panel, so an inset would be wrong. Each is a
 * full-height inspector/panel, not prose.
 */
const FULL_BLEED = new Set([
  'components/ActivityLogPage.js',      // ActivityLogPanel — .alp-root fills, own bg
  'components/TokenExchangeModal.jsx',  // TokenExchangeInspector — full-height panel
  'components/TokenFlowDetailModal.jsx', // .tfd-root — own theme + toolbar
  'components/TokenTopologyPanel.jsx',  // .ttp-root — own theme + toolbar
  'pages/PrivilegeMcpClientPage.jsx',   // PrivilegeMcpLearningPage — whole page in a modal
]);

/**
 * Callers that pad their first child themselves instead of using `.dm-scroll`.
 * Equivalent in effect; listed so the count is explicit rather than assumed.
 */
const SELF_PADDED = new Set([
  'components/AIAgent.js',
  'components/AgentConsentModal.js',
  'components/AgentDemoGuide.jsx',
  'components/ApiCallsModal.js',
  'components/ClaimDetailsModal.jsx',
  'components/ComplianceModal.js',
  'components/Dashboard.js',
  'components/DemoAuthzFallbackModal.jsx',
  'components/DemoTrackAgentControl.jsx',
  'components/GroupMembershipToggle.jsx',
  'components/LoginSuccessModal.jsx',
  'components/MCPToolsListModal.js',
  'components/MFALogsModal.jsx',
  'components/PreflightModal.jsx',
  'components/TokenChainDisplay.jsx',
  'components/TokenChainModal.js',
  'components/TransactionConsentModal.tsx',
  'components/UnattendedRunsPanel.jsx',
  'pages/DelegatedCommercePage.jsx',
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      return e.name === 'node_modules' || e.name === '__tests__' ? [] : walk(full);
    }
    return /\.(js|jsx|ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe('DraggableModal body contract', () => {
  it('every caller either wraps in .dm-scroll or is a declared exception', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('<DraggableModal')) continue;
      const rel = path.relative(SRC, file);
      if (FULL_BLEED.has(rel) || SELF_PADDED.has(rel)) continue;
      if (!text.includes('dm-scroll')) offenders.push(rel);
    }
    expect(
      offenders,
      `These render a DraggableModal body with no .dm-scroll wrapper: ` +
        `${offenders.join(', ')}. .dm-body has no padding and no scroll, so the ` +
        `content will sit flush against the panel edge and clip instead of ` +
        `scrolling. Wrap it in <div className="dm-scroll">, merge the class onto ` +
        `a single root child, or — if the body is deliberately full-bleed — add ` +
        `the file to FULL_BLEED / SELF_PADDED here with a reason.`,
    ).toEqual([]);
  });

  it('the exception lists are not stale — every named file still exists and still opens a modal', () => {
    // A renamed or deleted caller leaves a dead entry that silently exempts
    // nothing, and worse, hides the next real offender behind a stale name.
    const dead = [];
    for (const rel of [...FULL_BLEED, ...SELF_PADDED]) {
      const full = path.join(SRC, rel);
      if (!fs.existsSync(full) || !fs.readFileSync(full, 'utf8').includes('<DraggableModal')) {
        dead.push(rel);
      }
    }
    expect(dead, `Stale exception entries — remove them: ${dead.join(', ')}`).toEqual([]);
  });
});
