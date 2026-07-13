import TokenChainTraceRail from '../TokenChainTraceRail';

/**
 * TokensPane — full token chain inspector under the Tokens tab.
 *
 * Mounts TokenChainTraceRail embedded in the clinical agent context.
 * Shows all token exchange details, steps, and claims in a compact trace rail.
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
          The full RFC 8693 exchange chain for this session — request flow,
          steps, and token details.
        </p>
      </header>
      <div className="ac-tokens-body">
        <TokenChainTraceRail />
      </div>
    </div>
  );
}
