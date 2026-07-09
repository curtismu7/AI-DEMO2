'use strict';

const { createVerticalPlugin } = require('../shared/createVerticalPlugin');
const { createUniversityStore } = require('./data');
const { buildUniversityTools } = require('./tools');

const store = createUniversityStore();
const { tools, execute } = buildUniversityTools(store);

const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\b(cancel|drop|withdraw)\b.*\b(registration|enrollment|course|section|class)\b/i, action: 'cancel_course_registration', extractsRecordId: true },
  { re: /\bwaitlist\b.{0,25}\b(course|class|section)\b|\bjoin\b.{0,15}\bwaitlist\b/i, action: 'waitlist_course', extractsRecordId: true },
  { re: /\baccept\b.{0,25}\b(aid|grant|loan|award|scholarship)\b/i, action: 'accept_financial_aid', extractsRecordId: true },
  { re: /\b(pay|make\s+a\s+payment|settle)\b.{0,25}\b(tuition|bill|balance|invoice|charge)\b/i, action: 'pay_tuition_balance', extractsAmount: true, extractsRecordId: true },
  { re: /\b(clear|release|remove|resolve)\b.{0,20}\bhold\b/i, action: 'release_hold', extractsRecordId: true },
  { re: /\b(request|apply\s+for|change|update)\b.{0,25}\b(housing|dorm|residence\s+hall|room)\b/i, action: 'request_housing_assignment', extractsRecordId: true },
  { re: /\b(renew|extend|reactivate)\b.{0,20}\b(parking|permit)\b/i, action: 'renew_parking_permit', extractsRecordId: true },
  { re: /\b(checkout|check\s+out|borrow|reserve)\b.{0,25}\b(book|item|resource|material)\b/i, action: 'checkout_library_item', extractsRecordId: true },
  { re: /\b(apply|submit)\b.{0,20}\bscholarship\b/i, action: 'apply_scholarship', extractsRecordId: true },
  { re: /\bfinancial\s+aid\b|\b(my\s+)?(grants?|loans?|aid\s+package|fafsa\s+status)\b/i, action: 'view_financial_aid' },
  { re: /\b(tuition|bill|billing|balance\s+due|invoice|charges?|fees?)\b/i, action: 'view_billing' },
  { re: /\b(my\s+)?holds?\b|\b(account|registration)\s+hold\b/i, action: 'view_holds' },
  { re: /\bdegree\s+audit\b|\bdegree\s+progress\b|\bhow\s+many\s+credits\b|\bcredits?\b.*\b(to\s+graduate|remaining|still\s+need|need\s+to\s+graduat)\w*|\bgraduat\w*\s+requirements?\b/i, action: 'view_degree_audit' },
  { re: /\b(my\s+)?(housing|dorm|residence\s+hall|room\s+assignment)\b/i, action: 'view_housing' },
  { re: /\b(dining|meal\s+plan|dining\s+dollars|cafeteria|swipes?)\b/i, action: 'view_dining' },
  { re: /\b(exam\s+schedule|final\s+exams?|midterm\s+schedule|when\s+is\s+my\s+(exam|final|midterm))\b/i, action: 'view_exam_schedule' },
  { re: /\badvisors?\b|\bmy\s+advisor\b|\bacademic\s+advisor\b/i, action: 'view_advisors' },
  /* PACK:heuristics:end */
  // Most specific first. release_transcript must precede view_courses; register_course must precede view_courses.
  { re: /\b(release|share|send)\s+(my\s+)?(official\s+)?transcript/i, action: 'release_transcript' },
  { re: /\b(register|enroll)\b.*\b(course|class)\b|\badd\s+a\s+(course|class)\b/i, action: 'register_course' },
  { re: /\bcredit\s*standing\b|\bcredits?\s*(earned)?\b|\bhold(s)?\b|\bgpa\b|\bstanding\b/i, action: 'view_standing' },
  { re: /\benrollment\s*(history)?\b|\bregistration\b|\bdrop\b|\bgrades?\b/i, action: 'view_enrollment_history' },
  { re: /\b(courses?|class(?:es)?)\b|\btranscript\b/i, action: 'view_courses' },
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'student';
  return [
    'You are Super University\'s Registrar Assistant (Scholar), a campus enrollment helper.',
    'You help students view enrolled courses, check credit standing and registration holds,',
    'review enrollment history, register for courses, and handle official transcript-release',
    'requests with the required consent and step-up verification.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed registrar actions; never reference financial or banking-account concepts.',
  ].join(' ');
}

module.exports = createVerticalPlugin({ id: 'university', store, tools, execute, heuristics: HEURISTICS, systemPrompt });
