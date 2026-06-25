'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { createHealthcareStore } = require('./data');
const { buildHealthcareTools } = require('./tools');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

const store = createHealthcareStore();
const { tools, execute } = buildHealthcareTools(store);

const HEURISTICS = [
  // Most specific first. release_records must precede view_records. sensitive_patient_records must precede view_records.
  { re: /\bsensitive\b.*\b(record|patient|data)\b|\b(patient|record)\b.*\bsensitive\b/i, action: 'sensitive_patient_records' },
  { re: /\b(release|share|send)\s+(my\s+)?(records?|medical\s+records?)\b/, action: 'release_records', extractsRecordId: true, paramHint: 'e.g. "release record 102" — check your records list for the ID' },
  // cancel/reschedule precede book + list so "cancel my appointment" and
  // "reschedule my appointment" don't fall to list_appointments.
  { re: /\bcancel\b.*\b(appointment|appt|visit)s?\b/, action: 'cancel_appointment', extractsRecordId: true, paramHint: 'e.g. "cancel appointment 202" — check your appointments list for the ID' },
  { re: /\b(reschedule|re-schedule|rebook|move|change)\b.*\b(appointment|appt|visit)s?\b/, action: 'reschedule_appointment', extractsAppointmentParams: true, extractsRecordId: true, paramHint: 'e.g. "reschedule appointment 202 to Friday"' },
  { re: /\b(?:book|schedule)\b.*\b(?:appointment|with|visit|checkup|dr|doctor|[a-z]+ology)\b|\bmake\b.*\bappointment\b/, action: 'book_appointment', extractsAppointmentParams: true, paramHint: 'e.g. "book with Dr. Smith on Friday" or "schedule cardiology next week"' },
  { re: /\b(my\s+)?appointments?\b|\bupcoming\s+visits?\b/, action: 'list_appointments' },
  // pay precedes the generic bill/billing view so "pay my bill" isn't swallowed.
  { re: /\b(pay|settle)\b.*\b(bill|invoice|balance)s?\b|\bpay\s+(my\s+)?bills?\b/, action: 'pay_bill', extractsAmount: true, extractsRecordId: true, paramHint: 'e.g. "pay bill 402" — check your billing list for the ID' },
  { re: /\bbills?\b|\bbilling\b|\binvoices?\b|\bwhat\s+do\s+i\s+owe\b|\bdo\s+i\s+owe\b|\bamount\s+due\b/, action: 'view_billing' },
  // claims precedes coverage so "insurance claims" routes to claims, not the
  // "insurance" branch of view_coverage.
  // --- 15-intent expansion (heuristic-backed) ---
  { re: /(?:refill\b|\brequest\b.{0,20}\brefill\b).{0,40}?\b(\d+)/i, action: 'refill_prescription', extractsRecordId: true },  // placement: before view_medications
  { re: /\b(medications?|prescriptions?|meds|rx)\b/i, action: 'view_medications' },  // placement: before view_coverage
  { re: /\blab(atory)? results?\b|\bblood\s+work\b|\btest results?\b|\blab\s+work\b|\bblood\s+test\b|\blab\s+panel\b/i, action: 'view_lab_results' },  // placement: before view_records
  { re: /\b(vitals?|vital signs?|blood pressure|bp reading|heart rate|pulse|weight|bmi|temperature|oxygen saturation|spo2|o2 sat)\b/i, action: 'view_vitals' },  // placement: before view_records
  { re: /\b((my|view|show|list)\s+referrals?|specialist\s+referral|referred\s+to)\b/i, action: 'view_referrals' },  // placement: before view_coverage
  // documents precedes list_messages/care_team so "uploaded files from my doctor" routes here, not care_team.
  { re: /\b(health\s+documents?|(my|what|which)\s+documents?|documents?\s+on\s+file|uploaded\s+(files?|documents?)|discharge\s+summar|operative\s+report|consent\s+form|clinical\s+notes?)\b/i, action: 'view_documents' },
  { re: /\b(inbox|secure\s+messages?|unread\s+messages?|my\s+messages?|portal\s+messages?|messages?\s+from\s+my\s+(doctor|provider|care\s+team))\b/i, action: 'list_messages' },  // placement: before mark_message_read
  { re: /care\s+team|my\s+(doctor|doctors|provider|providers|physician|physicians|specialist|specialists)|who\s+(is|are)\s+my\s+(doctor|provider|physician)/i, action: 'view_care_team' },  // placement: before book_appointment
  { re: /\bclaims?\b|\bclaim\s+status\b/, action: 'view_claims' },
  { re: /\b(check\s+)?(my\s+)?coverage\b|\binsurance\b|\bdeductible\b|\breferrals?\b/, action: 'view_coverage' },
  { re: /\b(my\s+)?(medical\s+)?records?\b|\bpatient\s+records?\b/, action: 'view_records' },
  { re: /\b(summari[sz]e|recent|past|last)\b.*\bvisits?\b|\bvisit\s+(history|summary)\b/, action: 'view_records' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('healthcare');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'patient';
  return [
    'You are CareConnect\'s Care Assistant, a healthcare scheduling and records helper.',
    'You help patients review medical records, check insurance coverage, manage appointments,',
    'and handle records-release requests with the required consent and step-up verification.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed healthcare actions; never reference financial or account concepts.',
  ].join(' ');
}

function getAuthz() {
  const out = {};
  for (const t of tools) out[t.name] = t.authz || {};
  return out;
}

module.exports = {
  getManifest,
  getTools: () => tools,
  getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],
  getSystemPrompt,
  getDataStore: () => store,
  executeTool: (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
