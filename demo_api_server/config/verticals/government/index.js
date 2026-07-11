'use strict';

const { createVerticalPlugin } = require('../shared/createVerticalPlugin');
const { createGovernmentStore } = require('./data');
const { buildGovernmentTools } = require('./tools');

const store = createGovernmentStore();
const { tools, execute } = buildGovernmentTools(store);

const HEURISTICS = [
  // sensitive_tax_record must precede the pack's view_tax_assessments read rule.
  { re: /\bsensitive\b.*\btax\b|\btax\b.*\bsensitive\b/i, action: 'sensitive_tax_record' },
  /* PACK:heuristics:start */
  { re: /\b(dispute|appeal|contest)\b.*\bviolation\b/i, action: 'dispute_violation', extractsRecordId: true },
  { re: /\b(reschedule|move|change)\b.*\bappointment\b/i, action: 'reschedule_gov_appointment', extractsRecordId: true },
  { re: /\bcancel\b.*\bpermit\b/i, action: 'cancel_permit', extractsRecordId: true },
  { re: /\bsubmit\b.*\b(filing|application|form)\b/i, action: 'submit_filing', extractsRecordId: true },
  { re: /\binspection\b.*\b(approv\w*|pass\w*)\b|\b(approv\w*|pass\w*)\b.*\binspection\b/i, action: 'approve_inspection', extractsRecordId: true },
  { re: /\bviolation\b.*\bclos\w*\b|\bclos\w*\b.*\bviolation\b/i, action: 'close_violation', extractsRecordId: true },
  { re: /\bschedule\b.*\binspection\b/i, action: 'schedule_inspection', extractsRecordId: true },
  { re: /\brenew\w*\b.*\bpermit\b|\bpermit\b.*\brenew\w*\b/i, action: 'renew_permit', extractsRecordId: true },
  // Chip gv8 — before bare "license" → view_permits
  { re: /\brenew\w*\b.*\b(professional\s+)?licen[cs]e|\b(professional\s+)?licen[cs]e\b.*\brenew\w*/i, action: 'renew_permit', extractsRecordId: true },
  { re: /\bcancel\b.*\bappointment\b/i, action: 'cancel_appointment', extractsRecordId: true },
  { re: /\binspections?\b/i, action: 'view_inspections' },
  { re: /\bviolations?\b|\bcode\s+enforcement\b/i, action: 'view_violations' },
  { re: /\bbusiness\s+licen[cs]e[s]?\b/i, action: 'view_business_licenses' },
  { re: /\bappointments?\b/i, action: 'view_appointments' },
  { re: /\btax\s*(assessment|bill|record)[s]?\b/i, action: 'view_tax_assessments' },
  { re: /\brecords?\s+request[s]?\b|\bFOIA\b/i, action: 'view_records_requests' },
  { re: /\bcomplaints?\b|\breported\s+issue[s]?\b/i, action: 'view_complaints' },
  /* PACK:heuristics:end */
  // Most specific first. release_record must precede view_permits; pay_fee must precede view_fees.
  { re: /\b(release|share|send|disclose)\s+(my\s+)?(permit\s+)?record/i, action: 'release_record', extractsRecordId: true, paramHint: 'e.g. "release record P-1001" — check your permits list for the ID' },
  { re: /\bpay\b.*\bfee\b|\bpay\b.*\bpermit\b/i, action: 'pay_fee', extractsAmount: true, paramHint: 'e.g. "pay the $150 building fee"' },
  { re: /\bfees?\s*(owed|due)?\b|\bwhat\s+do\s+i\s+owe\b|\bbalance\b/i, action: 'view_fees' },
  { re: /\b(filing|inspection|renewal)s?\b|\bfiling\s+history\b/i, action: 'view_filings' },
  { re: /\b(permit|license)s?\b/i, action: 'view_permits' },
  { re: /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|charge|spend|filing|fee)|check for unusual|flag any unusual|spot unusual/i, action: 'view_filings' },
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'resident';
  return [
    'You are CivicPermit\'s Permit Assistant (Liberty), a citizen-services helper for permits and licensing.',
    'You help residents view permits and licenses, check outstanding fees, review filing history,',
    'pay fees, and handle permit-record release requests with the required consent and step-up verification.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed permitting actions; never reference financial or banking-account concepts.',
  ].join(' ');
}

module.exports = createVerticalPlugin({ id: 'government', store, tools, execute, heuristics: HEURISTICS, systemPrompt });
