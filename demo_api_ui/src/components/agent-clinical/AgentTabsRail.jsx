/**
 * AgentTabsRail — the only chrome control on the clinical-split dashboard.
 *
 * Replaces the ~12 peer toolbar controls (Theme dropdown, Middle/Float toggle,
 * Always-float checkbox, Controls, Reset Demo, Customer badge, Token timer,
 * Search, avatar) with a single 44-px rail:
 *
 *   ┌ CareConnect ─────────── [▣ Talk · ◇ Inspect · ⊞ Configure] ─────────── SESSION · 25:54 · ⌕ · DU ┐
 *
 * Keyboard 1 / 2 / 3 switch tabs (wired in AgentClinicalHost).
 */
export default function AgentTabsRail({
  view,
  onChange,
  brandPrefix = 'Care',
  brandSuffix = 'Connect',
  sessionLabel = 'SESSION',
  userInitials = 'DU',
}) {
  return (
    <div className="ac-rail">
      <div className="ac-brand">{brandPrefix}<em>{brandSuffix}</em></div>

      <div className="ac-tabs" role="tablist" aria-label="Agent view">
        <TabButton id="talk"      label="Talk"      glyph="▣" kbd="1" active={view === 'talk'}      onClick={onChange} />
        <TabButton id="inspect"   label="Inspect"   glyph="◇" kbd="2" active={view === 'inspect'}   onClick={onChange} />
        <TabButton id="configure" label="Configure" glyph="⊞" kbd="3" active={view === 'configure'} onClick={onChange} />
      </div>

      <div className="ac-rail-right">
        <span className="ac-session" title="Session timer">
          <span className="ac-session-led" />
          {sessionLabel}
        </span>
        <button type="button" className="ac-icn" title="Search ⌘K" aria-label="Search">⌕</button>
        <span className="ac-avatar" title={`Account ${userInitials}`}>{userInitials}</span>
      </div>
    </div>
  );
}

function TabButton({ id, label, glyph, kbd, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`ac-tab${active ? ' ac-tab--on' : ''}`}
      onClick={() => onClick(id)}
    >
      <span className="ac-tab-glyph" aria-hidden="true">{glyph}</span>
      <span>{label}</span>
      <kbd className="ac-tab-kbd">{kbd}</kbd>
    </button>
  );
}
