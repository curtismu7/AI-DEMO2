// ---------------------------------------------------------------------------
// Elicitation store — session-scoped pending elicitation records.
// A record is created when P1AZ returns an ELICITATION obligation. It is
// consumed (deleted) on a valid re-call with _elicitation_confirmed:true.
// Shared by both transports (WS index.ts and HTTP authorizeMcpRequest.ts) —
// a record minted on one transport must be consumable on the other.
// ---------------------------------------------------------------------------

import * as crypto from 'crypto';

export interface PendingElicitation {
  elicitation_id: string;
  toolName: string;
  sessionId: string;
  prompt: string;
  expiresAt: number;
}

const ELICITATION_TTL_MS = 120_000;

const pendingElicitations = new Map<string, PendingElicitation>();

export function createPendingElicitation(
  toolName: string,
  sessionId: string,
  prompt: string,
): PendingElicitation {
  const record: PendingElicitation = {
    elicitation_id: crypto.randomUUID(),
    toolName,
    sessionId,
    prompt,
    expiresAt: Date.now() + ELICITATION_TTL_MS,
  };
  pendingElicitations.set(record.elicitation_id, record);
  return record;
}

/** One-time-use, session- and tool-bound. Returns null and leaves nothing behind on any mismatch. */
export function consumePendingElicitation(
  elicitationId: string,
  toolName: string,
  sessionId: string,
): PendingElicitation | null {
  const rec = pendingElicitations.get(elicitationId);
  if (!rec || rec.toolName !== toolName || rec.sessionId !== sessionId || rec.expiresAt < Date.now()) {
    return null;
  }
  pendingElicitations.delete(rec.elicitation_id);
  return rec;
}

export function _resetElicitationStoreForTest(): void {
  pendingElicitations.clear();
}

// Sweep expired records every 60 seconds.
setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of pendingElicitations) {
    if (rec.expiresAt < now) pendingElicitations.delete(id);
  }
}, 60_000).unref();
