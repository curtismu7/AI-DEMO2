// Reads audit.jsonl written by server.mjs and asserts the OBO + "model never sees the user token" claims.
import fs from 'node:fs';
const file = process.argv[2] || new URL('./audit.jsonl', import.meta.url).pathname;
const calls = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.event === 'tool_call');
if (!calls.length) { console.log('FAIL no tool_call in audit - ask Claude to call act_on_my_behalf first'); process.exit(1); }
const c = calls.at(-1);
const a = c.exchanged.act; // object ({client_id|sub}) or bare client_id string, depending on the resource's act mapping
const actorOk = a && [a, a.client_id, a.sub].includes(c.agent_client_id);
const checks = [
  ['delegated token is for the same user (sub preserved)', c.exchanged.sub === c.inbound.sub],
  ['delegated token carries act claim naming the agent (delegation, not impersonation)', !!actorOk],
  ['delegated token is a different token from the user token', c.exchanged.sha !== c.inbound.sha],
  ['delegated token audience differs from the one Claude held', JSON.stringify(c.exchanged.aud) !== JSON.stringify(c.inbound.aud)],
  ['downstream accepted the delegated token', c.downstream.with_exchanged === 200],
  ['downstream refused the user token (agent could not have used it)', c.downstream.with_user_token === 401],
  ['tool result shown to the model contained no token', c.tool_result_leaks_token === false],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log('\nuser sub      :', c.inbound.sub, '\ninbound aud   :', JSON.stringify(c.inbound.aud), '\nexchanged act :', JSON.stringify(c.exchanged.act), '\nexchanged aud :', JSON.stringify(c.exchanged.aud), '\nscope         :', c.exchanged.scope);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
