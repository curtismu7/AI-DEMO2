'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { createWorkforceStore } = require('./data');
const { buildWorkforceTools } = require('./tools');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

const store = createWorkforceStore();
const { tools, execute } = buildWorkforceTools(store);

// Most specific first: write actions before the read views they share words with; sensitive_payroll_details must be early.
const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\bcancel\b.*\bexpense\b|\bwithdraw\b.*\bexpense\b/i, action: 'cancel_expense', extractsRecordId: true },
  { re: /\benroll\b.*\b(training|course)\b|\bsign\s+(me\s+)?up\b.*\b(training|course)\b/i, action: 'enroll_training', extractsRecordId: true },
  { re: /\bclose\b.*\bticket\b|\bresolve\b.*\bticket\b/i, action: 'close_ticket', extractsRecordId: true },
  { re: /\bcomplete\b.*\bgoal\b|\bmark\b.*\bgoal\b.*\bdone\b/i, action: 'complete_goal', extractsRecordId: true },
  { re: /\bpay\s*slip[s]?\b|\bpay\s*stub[s]?\b|\bpaycheck[s]?\b|\bmy\s+pay\s+history\b/i, action: 'view_payslips' },
  { re: /\btraining[s]?\b|\blearning\s+(courses?|catalog|modules?)\b|\bmy\s+courses?\b/i, action: 'view_trainings' },
  { re: /\bmy\s+tickets?\b|\bsupport\s+(tickets?|requests?)\b|\bhelp\s+desk\b|\bIT\s+tickets?\b/i, action: 'view_tickets' },
  { re: /\b(my\s+)?schedule\b|\bwork\s+(shifts?|hours|calendar)\b|\bshift[s]?\b/i, action: 'view_schedule' },
  { re: /\bmy\s+goals?\b|\bperformance\s+goals?\b|\bobjectives?\b|\bOKR[s]?\b/i, action: 'view_goals' },
  { re: /\bteam\s+(members?|directory)\b|\bcolleagues?\b|\borg\s*chart\b|\bwho\s+(is\s+on\s+my\s+team|do\s+I\s+work\s+with)\b/i, action: 'view_colleagues' },
  /* PACK:heuristics:end */
  { re: /\bsensitive\b.*\b(payroll|salary|pay)\b|\b(payroll|salary|pay)\b.*\bsensitive\b/i, action: 'sensitive_payroll_details' },
  { re: /\bsubmit\b.*\bexpense\b|\bfile\b.*\bexpense\b/, action: 'submit_expense', extractsExpenseParams: true, paramHint: 'e.g. "submit expense taxi $45" or "file expense hotel $120"' },
  { re: /\b(request|take)\b.*\b(time\s+off|days?\s+off|pto|vacation|leave)\b|\b\d+\s+days?\s+off\b/, action: 'request_time_off', extractsDays: true, paramHint: 'e.g. "request 3 days off" or "take 5 vacation days"' },
  { re: /\b(my\s+)?expenses?\b|\bexpense\s+(history|reports?)\b/, action: 'list_expenses' },
  { re: /\b(pending|waiting|awaiting|unapproved|sign[\s-]?off|approvals?)\b/, action: 'list_expenses' },
  { re: /\b(check\s+|my\s+|how\s+much\s+)?(pto|time\s+off|vacation|sick\s+leave)\s*(balance|left|remaining)?\b/, action: 'pto_balance' },
  { re: /\b(my\s+)?benefits?\b|\benrollments?\b|\bmedical\b|\bdental\b/, action: 'view_benefits' },
];

function getManifest() { return verticalManifest.resolver.resolve('workforce'); }
function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'employee';
  return [
    'You are WX Workforce\'s HR Assistant, a benefits, PTO, and expense helper.',
    'You help employees review benefits enrollments, check PTO and sick leave balances, list expense reports, submit expenses, and request time off.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed workforce actions; never reference financial or account concepts.',
  ].join(' ');
}
function getAuthz() { const o = {}; for (const t of tools) o[t.name] = t.authz || {}; return o; }

module.exports = {
  getManifest,
  getTools: () => tools,
  getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],
  getSystemPrompt,
  getDataStore: () => store,
  executeTool: (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
