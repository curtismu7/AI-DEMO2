import UnifiedTokenFlowInspector from '../UnifiedTokenFlowInspector';

/**
 * TokensPane — full token chain inspector under the Tokens tab.
 *
 * Mounts the existing UnifiedTokenFlowInspector embedded (same props as
 * DevToolsDashboard: not floating, no toggle — the tab is the dismiss).
 * The component brings its own chrome and data layer; this pane only adds
 * the clinical header and a scroll container.
 */
export default function TokensPane() {
  return (
    <div className="ac-tokens">
      <header className="ac-tokens-head">
        <div className="ac-eyebrow ac-eyebrow--small">Tokens · chain</div>
        <h1 className="ac-tokens-h1">
          Every token, <i>traced</i>
        </h1>
        <p className="ac-tokens-sub">
          The full RFC 8693 exchange chain for this session — request flow on
          the left, minted tokens and claims on the right.
        </p>
      </header>
      <div className="ac-tokens-body">
        <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} />
      </div>
    </div>
  );
}
