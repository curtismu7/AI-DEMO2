import { useEffect, useRef, useState } from "react";
import "./McpTransferApprovalFrame.css";
import InlineSpinner from './shared/InlineSpinner';

type Props = {
  snapshot: Record<string, unknown> | null;
  accounts: Array<Record<string, unknown>>;
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  disabled?: boolean;
};

const RESOURCE_URL = "/api/mcp/apps/transfer-approval";

export default function McpTransferApprovalFrame({
  snapshot,
  accounts,
  onApprove,
  onReject,
  disabled = false,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const channelIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  );
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || !event.data) return;
      const sourceMatches = event.source === frame.contentWindow;
      if (event.data.type === "mcp-app-ready") {
        if (!sourceMatches) return;
        setReady(true);
        frame.contentWindow?.postMessage(
          {
            type: "mcp-app-host-init",
            channelId: channelIdRef.current,
            snapshot,
            accounts,
          },
          "*",
        );
        return;
      }
      const channelMatches = event.data.channelId === channelIdRef.current;
      if ((!sourceMatches && !channelMatches) || disabled || event.data.method !== "tools/call") return;
      const toolName = event.data.params?.name;
      if (toolName === "approve_transfer") onApprove();
      if (toolName === "reject_transfer") onReject();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [accounts, disabled, onApprove, onReject, snapshot]);

  if (failed) {
    return (
      <div className="mcp-transfer-app-fallback" role="status">
        The approval view is unavailable. Use the standard approval controls below.
      </div>
    );
  }

  return (
    <div className="mcp-transfer-app-frame">
      {!ready && <div className="mcp-transfer-app-loading"><InlineSpinner label="Loading the approval view…" /></div>}
      <iframe
        ref={frameRef}
        title="MCP transfer approval"
        src={RESOURCE_URL}
        sandbox="allow-scripts allow-same-origin"
        onError={() => setFailed(true)}
        className="mcp-transfer-app-iframe"
      />
    </div>
  );
}
