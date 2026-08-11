import EducationDrawer from '../shared/EducationDrawer';

export default function KillSwitchMechanismsPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'How Stop Agent actually works',
      content: (
        <>
          <p>
            Clicking <strong>Stop Agent</strong> writes one flag — <code>agent:&lt;key&gt;:revoked</code> —
            through the same generic session-store interface every session already uses (no Redis in this
            deployment). That flag is checked in exactly one place that matters: <code>runMcpToolPipeline</code>,
            the MCP tool dispatch handler, right before the branch that decides whether PingOne Authorize runs
            locally or whether the call is gateway-authoritative. This placement covers both routing modes,
            unlike earlier versions of this feature. A killed agent&apos;s <strong>next</strong> tool call gets a
            403 <code>agent_killed</code> — nothing in flight is interrupted, and nothing halts a loop, because
            there is no persistent loop in this codebase to halt: every agent action lives for one HTTP
            request/SSE response.
          </p>
          <p>
            The key that flag is written and read under is the PingOne user id (<code>userSub</code> /
            <code>session.user.oauthId</code>), not a per-agent-client identity. This means a kill stops
            <em>this user&apos;s</em> agent access entirely, not a specific agent client instance — since no
            real per-agent-client distinguishing id is currently plumbed through any UI surface
            (<code>ControlPlaneRoster</code>&apos;s <code>live.id</code> resolves to a hardcoded label today).
            PingOne Authorize also revokes the underlying OAuth token (RFC 7009) as a second, independent
            enforcement layer.
          </p>
        </>
      ),
    },
    {
      id: 'audit',
      label: 'Active-run audit trail',
      content: (
        <>
          <p>
            A second, independent piece: every real tool call is bracketed with <code>startRun</code>/<code>endRun</code>
            against a small LMDB-backed registry, keyed the same way the kill check is. The confirm modal reads it
            before you click, so it can say <em>&quot;this will stop: reorder, started 4s ago&quot;</em> instead of a
            blind revoke — this is what the original ask (&quot;must explain, not just shut down&quot;) is actually
            answered by.
          </p>
          <p>
            This is audit visibility, not a second enforcement layer — the registry doesn&apos;t block anything by
            itself. A crashed process that never reaches <code>endRun</code> can&apos;t leak an entry forever: every
            row carries a 30-minute TTL, swept every 5 minutes, the same pattern the revoked flag itself uses.
          </p>
          <p>
            <strong>Known limitation (audit coverage gap):</strong> The registry is wired at three call sites in
            <code>bffMcpToolExecutor.js</code> (the agent/A2A execution path) via <code>startRun</code>/<code>endRun</code>.
            The two most direct tool-call routes — <code>POST /api/mcp/tool</code> and <code>POST /api/rpc</code> in
            <code>server.js</code> — call <code>runMcpToolPipeline</code> directly and register nothing with
            <code>agentRunRegistry</code>. This means the confirm modal&apos;s &quot;this will stop: X, started Ns
            ago&quot; list can show &quot;nothing currently running&quot; for exactly the call a kill is about to
            block, if that call came through one of those two routes. This is <em>informational</em> incompleteness
            only — the kill check itself is relocated into <code>runMcpToolPipeline</code> and covers all callers, so
            enforcement is not weakened; the pre-kill display is simply incomplete for those paths.
          </p>
        </>
      ),
    },
    {
      id: 'research',
      label: 'Prior art & RFCs',
      content: (
        <>
          <p>
            &quot;Kill switch&quot; isn&apos;t a standardized term in agent frameworks — the real mechanisms are
            cancel APIs plus policy gates: OpenAI&apos;s <code>POST /threads/&#123;id&#125;/runs/&#123;run_id&#125;/cancel</code>,
            Anthropic&apos;s Agent SDK <code>query.interrupt()</code>, LangGraph&apos;s <code>runs.cancel()</code> plus
            checkpointed <code>interrupt()</code>/<code>Command(resume=...)</code> for human-in-the-loop pauses.
            &quot;Circuit breaker&quot; (threshold-triggered auto-pause) and &quot;kill switch&quot; (operator-initiated
            hard stop) are the terms with real industry traction — this feature is the latter.
          </p>
          <p>
            <strong>CAEP (Continuous Access Evaluation Profile, OpenID Foundation)</strong> went final in August 2025
            with a <code>session-revoked</code> event type — this exact use case — built on RFC 8417 (Security Event
            Token) and RFC 8935 (push delivery). Production users include Okta, Microsoft Entra CAE, Google Workspace,
            Apple, Cisco Duo, and SailPoint. This design&apos;s revoke-then-check pattern already matches what CAEP
            prescribes for receivers.
          </p>
          <p>
            <code>draft-klrc-aiagent-auth-03</code> — an IETF individual draft co-authored by Ping Identity&apos;s
            Brian Campbell with Okta and OpenAI authors — prescribes CAEP/RISC subscriptions for AI agents and states
            cached tokens <strong>MUST NOT</strong> be used after a revocation notification, directly validating this
            pattern.
          </p>
          <p>
            <strong>GNAP (RFC 9635, Oct 2024)</strong> offers cleaner grant-level revocation (delete the whole grant,
            no new tokens issuable) than OAuth&apos;s per-token RFC 7009 — but has near-zero production adoption, so
            it&apos;s cited as rationale only, not something this demo builds on.
          </p>
          <p>
            OWASP&apos;s Excessive Agency is <strong>LLM06</strong> on the LLM Top 10; the newer OWASP Agentic AI
            Threats and Mitigations document names kill switches explicitly under <strong>T6</strong> (Intent
            Breaking &amp; Goal Manipulation).
          </p>
        </>
      ),
    },
    {
      id: 'spicedb',
      label: "SpiceDB — where it fits and where it doesn't",
      content: (
        <>
          <p>
            <strong>SpiceDB</strong> (AuthZed&apos;s implementation of Google&apos;s Zanzibar paper) was evaluated
            for the active-run registry above and is <strong>the wrong tool for that piece</strong>. Zanzibar-style
            relationship stores hold a permission graph, not fast-changing operational metadata — writing on every
            single tool-call start/end is high churn against a system tuned for a slowly-changing graph. No
            production examples were found of Zanzibar/SpiceDB used as a live session/run registry; the standard
            architecture is &quot;SpiceDB for permissions, a KV store for live state,&quot; which is exactly the
            split this feature landed on (LMDB for the registry).
          </p>
          <p>
            SpiceDB <strong>does</strong> fit a different, related question this feature doesn&apos;t answer today:
            <em> &quot;who may kill which agent&quot;</em> — modeled as a relationship tuple like
            <code> agent:X#killer@user:alice</code>. Right now, any authenticated session can stop any agent it can
            see. A real deployment would want that gated, and SpiceDB is a defensible way to model it — a genuine
            future extension, not built here.
          </p>
          <p>
            <strong>Known limitation (authorization gap):</strong> The kill-switch endpoint
            <code>POST /api/admin/agent/:agentId/kill-switch</code> requires only <code>authenticateToken</code> and
            performs no check that the caller and target user are the same identity, or that the caller has elevated
            rights to target a different user. Because the endpoint accepts a real, non-placeholder user id (the
            derived key) as <code>:agentId</code> and the write side honors it verbatim, any authenticated user can
            revoke any other user&apos;s agent access — a cross-user denial of service. This is now consequential
            because enforcement actually works (before this branch&apos;s fixes, the kill check was bypassed by certain
            tool-call routes). This is exactly the scenario SpiceDB could address: modeling fine-grained
            &quot;who may kill which agent&quot; rules instead of the current blanket &quot;any authenticated user may
            kill any agent.&quot;
          </p>
        </>
      ),
    },
    {
      id: 'not-built',
      label: 'Not built — concepts only',
      content: (
        <>
          <p>
            Three ideas from the research were deliberately <strong>not implemented</strong> in this pass — they
            remain concepts to explain, not code to demo:
          </p>
          <h4>Mid-flight abort (CAEP-shaped push)</h4>
          <p>
            Everything above blocks the agent&apos;s <em>next</em> call — a call already in flight when you click
            Stop finishes on its own. A true mid-flight abort would name the kill event <code>session-revoked</code>
            (CAEP vocabulary), shape the payload like a Security Event Token (RFC 8417), push it over the existing
            kill-switch SSE hub, and have the in-flight handler hold an <code>AbortController</code> tied to its
            run — cancelling the actual external call the instant the push arrives. It wasn&apos;t built because
            real tool calls in this demo are short enough that the window a call could still be in flight is
            milliseconds, not because it&apos;s a hard problem — see the design spec&apos;s &quot;Rejected
            approaches&quot; for the full reasoning.
          </p>
          <h4>Full SSF/CAEP cross-system transport</h4>
          <p>
            CAEP&apos;s real transport is RFC 8935 HTTP push to an external Security Event Token Receiver — for a
            different application entirely to subscribe to this app&apos;s revocation events. This demo has no such
            external receiver, so only the internal naming/payload convention was adopted, not the transport.
          </p>
          <h4>SpiceDB-based &quot;who may kill which agent&quot;</h4>
          <p>
            Covered on the SpiceDB tab — a real, defensible extension, not part of this feature&apos;s scope.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Kill Switch"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
