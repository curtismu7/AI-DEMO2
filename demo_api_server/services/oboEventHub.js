'use strict';
// In-memory pub/sub keyed by user sub, with a short replay buffer so a page opened after the call
// still shows it. ponytail: single process only (same limit as mcpFlowSseHub); use Redis pub/sub if the BFF scales out.
const BUFFER_MAX = 5;
const subscribers = new Map(); // sub -> Set<res>
const buffers = new Map();     // sub -> evidence[]

function publish(sub, evidence) {
  const buf = buffers.get(sub) || [];
  buf.push(evidence);
  while (buf.length > BUFFER_MAX) buf.shift();
  buffers.set(sub, buf);
  const line = `data: ${JSON.stringify(evidence)}\n\n`;
  for (const res of subscribers.get(sub) || []) res.write(line);
}

function subscribe(sub, res) {
  const set = subscribers.get(sub) || new Set();
  set.add(res);
  subscribers.set(sub, set);
  for (const ev of buffers.get(sub) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  return () => set.delete(res);
}

function _reset() { subscribers.clear(); buffers.clear(); }

module.exports = { publish, subscribe, _reset };
