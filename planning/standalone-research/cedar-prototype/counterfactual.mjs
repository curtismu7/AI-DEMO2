// Cedar's diagnostics.reason names only the policies that decided. To show "the permit would have said yes",
// re-run with forbids removed. Same request as S23 (12000 booking).
import { readFileSync } from 'node:fs';
import cedar from '@cedar-policy/cedar-wasm/nodejs';
const all = JSON.parse(readFileSync('./policies.json','utf8'));
const permitsOnly = Object.fromEntries(Object.entries(all).filter(([,t]) => /(^|\n)permit/.test(t)));
const e=[{uid:{type:'User',id:'ta1'},attrs:{},parents:[{type:'Group',id:'travel-agents'}]},{uid:{type:'Group',id:'travel-agents'},attrs:{},parents:[]},{uid:{type:'Tool',id:'book_fare'},attrs:{},parents:[]}];
const run=(ps)=>cedar.isAuthorized({principal:{type:'User',id:'ta1'},action:{type:'Action',id:'mcp:Invoke'},resource:{type:'Tool',id:'book_fare'},context:{app:'booking',args:{amount:12000},token:{scopes:[],client_id:'dot'},approval_count:0,pinnedHash:'h',observedHash:'h'},policies:{staticPolicies:ps,templates:{},templateLinks:[]},entities:e}).response;
const f=run(all), p=run(permitsOnly);
console.log('full policy set ', f.decision, f.diagnostics.reason);
console.log('permits only    ', p.decision, p.diagnostics.reason);
