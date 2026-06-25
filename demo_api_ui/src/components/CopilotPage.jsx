/**
 * CopilotPage — route target for /copilot.
 *
 * Gates the standalone Copilot Studio chat surface behind the public
 * `copilot_mode_enabled` config flag (read via useAppFlags). When the flag is
 * off (the default), it renders a "not enabled" notice instead of the surface.
 */

import { useAppFlags } from "../hooks/useAppFlags";
import CopilotAgent from "./CopilotAgent";
import "./CopilotAgent.css";

export default function CopilotPage() {
  const { appFlags } = useAppFlags();

  if (!appFlags.copilotMode) {
    return (
      <div className="copilot-surface copilot-empty">
        <h2>Copilot agent</h2>
        <p className="copilot-notice">
          The Copilot agent mode is turned off. Enable <code>copilot_mode_enabled</code> on the
          Configuration page to use it.
        </p>
      </div>
    );
  }

  return <CopilotAgent />;
}
