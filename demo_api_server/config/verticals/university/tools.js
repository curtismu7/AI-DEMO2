'use strict';

/**
 * Super University (university) tools — the vertical's OWN actions over its
 * OWN data store. No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildUniversityTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'cancel_course_registration', description: "Drop (cancel) a registered course by courseId.", inputSchema: { type: 'object', properties: { courseId: { type: 'string' } }, required: ['courseId'] }, scopes: ['write'], authz: {} },
    { name: 'waitlist_course', description: "Add a student to the waitlist for a full course by courseId.", inputSchema: { type: 'object', properties: { courseId: { type: 'string' } }, required: ['courseId'] }, scopes: ['write'], authz: {} },
    { name: 'accept_financial_aid', description: "Accept a pending financial aid award or loan offer by aidId.", inputSchema: { type: 'object', properties: { aidId: { type: 'string' } }, required: ['aidId'] }, scopes: ['write'], authz: {} },
    { name: 'pay_tuition_balance', description: "Mark a tuition bill as paid by billId.", inputSchema: { type: 'object', properties: { billId: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] }, scopes: ['write'], authz: {} },
    { name: 'release_hold', description: "Request release of an account hold by holdId.", inputSchema: { type: 'object', properties: { holdId: { type: 'string' } }, required: ['holdId'] }, scopes: ['write'], authz: {} },
    { name: 'request_housing_assignment', description: "Submit or change a housing assignment request by housingId.", inputSchema: { type: 'object', properties: { housingId: { type: 'string' } }, required: ['housingId'] }, scopes: ['write'], authz: {} },
    { name: 'renew_parking_permit', description: "Renew a campus parking permit by permitId.", inputSchema: { type: 'object', properties: { permitId: { type: 'string' } }, required: ['permitId'] }, scopes: ['write'], authz: {} },
    { name: 'checkout_library_item', description: "Check out or reserve a library item by itemId.", inputSchema: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'] }, scopes: ['write'], authz: {} },
    { name: 'apply_scholarship', description: "Submit an application for a scholarship by scholarshipId.", inputSchema: { type: 'object', properties: { scholarshipId: { type: 'string' } }, required: ['scholarshipId'] }, scopes: ['write'], authz: {} },
    { name: 'view_financial_aid', description: "View the student's financial aid awards, loans, and grants.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_billing', description: "View the student's tuition charges, fees, and billing balance.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_holds', description: "View all active and resolved holds on the student's account.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_degree_audit', description: "View the student's degree audit showing completed and remaining graduation requirements.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_housing', description: "View the student's on-campus housing assignment details.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_dining', description: "View the student's meal plan, dining dollar balance, and recent dining transactions.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_exam_schedule', description: "View the student's upcoming exam schedule including finals and midterms.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_parking', description: "View the student's campus parking permits and citation history.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_library', description: "View the student's checked-out library items, due dates, and reservations.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_scholarships', description: "View available and applied-for scholarships the student can pursue.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_advisors', description: "List the student's assigned academic advisors and their contact details.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    { name: 'view_courses', description: 'List the student\'s enrolled courses.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_standing', description: 'Show the student\'s credit standing and registration holds.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_enrollment_history', description: 'List the student\'s enrollment history (registrations, drops, grades).', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'register_course', description: 'Register the student for a new course.', inputSchema: { type: 'object', properties: { course: { type: 'string' }, title: { type: 'string' } } }, scopes: ['write'], authz: {} },
    { name: 'release_transcript', description: 'Release the student\'s official transcript to a third party (requires step-up + consent).', inputSchema: { type: 'object', properties: { recipient: { type: 'string' } } }, scopes: ['write'], authz: { stepUp: true, consent: true } },
    { name: 'sensitive_student_finance', description: 'Access highly sensitive student financial aid records. Requires explicit user consent.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: { consent: true } },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      /* PACK:cases:start */
      case 'cancel_course_registration': {
        const _id = params && (params.courseId || params.recordId);
        const _arr = store.get(userId).courses || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'course registration not found' }, render: 'text' };
        Object.assign(_item, { status: 'Dropped' });
        return { result: _item, render: 'cancel_course_registration' };
      }
      case 'waitlist_course': {
        const _id = params && (params.courseId || params.recordId);
        const _arr = store.get(userId).courses || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'course waitlist not found' }, render: 'text' };
        Object.assign(_item, { status: 'Waitlisted' });
        return { result: _item, render: 'waitlist_course' };
      }
      case 'accept_financial_aid': {
        const _id = params && (params.aidId || params.recordId);
        const _arr = store.get(userId).financial_aid || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'financial aid award not found' }, render: 'text' };
        Object.assign(_item, { status: 'Accepted' });
        return { result: _item, render: 'accept_financial_aid' };
      }
      case 'pay_tuition_balance': {
        const _id = params && (params.billId || params.recordId);
        const _arr = store.get(userId).billing || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        // Amount-driven policy chip ("pay $300 tuition") carries no bill id — default to the first tuition bill.
        if (!_item && !_id) _item = _arr[0];
        if (!_item) return { result: { error: 'tuition bill not found' }, render: 'text' };
        Object.assign(_item, { status: 'Paid' });
        return { result: _item, render: 'pay_tuition_balance' };
      }
      case 'release_hold': {
        const _id = params && (params.holdId || params.recordId);
        const _arr = store.get(userId).holds || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'account hold not found' }, render: 'text' };
        Object.assign(_item, { status: 'Released' });
        return { result: _item, render: 'release_hold' };
      }
      case 'request_housing_assignment': {
        const _id = params && (params.housingId || params.recordId);
        const _arr = store.get(userId).housing || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'housing assignment not found' }, render: 'text' };
        Object.assign(_item, { status: 'Requested' });
        return { result: _item, render: 'request_housing_assignment' };
      }
      case 'renew_parking_permit': {
        const _id = params && (params.permitId || params.recordId);
        const _arr = store.get(userId).parking || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'parking permit not found' }, render: 'text' };
        Object.assign(_item, { status: 'Renewed' });
        return { result: _item, render: 'renew_parking_permit' };
      }
      case 'checkout_library_item': {
        const _id = params && (params.itemId || params.recordId);
        const _arr = store.get(userId).library || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'library item not found' }, render: 'text' };
        Object.assign(_item, { status: 'Checked Out' });
        return { result: _item, render: 'checkout_library_item' };
      }
      case 'apply_scholarship': {
        const _id = params && (params.scholarshipId || params.recordId);
        const _arr = store.get(userId).scholarships || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'scholarship not found' }, render: 'text' };
        Object.assign(_item, { status: 'Applied' });
        return { result: _item, render: 'apply_scholarship' };
      }
      case 'view_financial_aid':
        return { result: { financial_aid: store.get(userId).financial_aid }, render: 'view_financial_aid' };
      case 'view_billing':
        return { result: { billing: store.get(userId).billing }, render: 'view_billing' };
      case 'view_holds':
        return { result: { holds: store.get(userId).holds }, render: 'view_holds' };
      case 'view_degree_audit':
        return { result: { degree_audit: store.get(userId).degree_audit }, render: 'view_degree_audit' };
      case 'view_housing':
        return { result: { housing: store.get(userId).housing }, render: 'view_housing' };
      case 'view_dining':
        return { result: { dining: store.get(userId).dining }, render: 'view_dining' };
      case 'view_exam_schedule':
        return { result: { exams: store.get(userId).exams }, render: 'view_exam_schedule' };
      case 'view_parking':
        return { result: { parking: store.get(userId).parking }, render: 'view_parking' };
      case 'view_library':
        return { result: { library: store.get(userId).library }, render: 'view_library' };
      case 'view_scholarships':
        return { result: { scholarships: store.get(userId).scholarships }, render: 'view_scholarships' };
      case 'view_advisors':
        return { result: { advisors: store.get(userId).advisors }, render: 'view_advisors' };
      /* PACK:cases:end */
      case 'view_courses':
        return { result: { courses: store.get(userId).courses }, render: 'view_courses' };
      case 'view_standing':
        return { result: store.get(userId).standing, render: 'view_standing' };
      case 'view_enrollment_history':
        return { result: { history: store.get(userId).enrollmentHistory }, render: 'view_enrollment_history' };
      case 'register_course':
        return { result: store.registerCourse(userId, params || {}), render: 'register_course' };
      case 'release_transcript':
        return { result: store.releaseTranscript(userId, params || {}), render: 'release_transcript' };
      case 'sensitive_student_finance':
        return {
          result: {
            data: {
              record: {
                awardYear: '2025-2026',
                grantAward: 6200,
                loanAmount: 8500,
                workStudy: 2000,
                expectedFamilyContribution: 4200,
                ssn: '[REDACTED]',
                status: 'Awarded',
              },
              sensitiveDataAccessed: true,
              accessGrantedBy: 'consent',
            },
          },
          render: 'text',
        };
      case 'api_key_demo':
      case 'dual_token_demo':
        return { result: { data: {} }, render: 'text' };
      default:
        return { result: { error: `unknown tool: ${name}` }, render: 'text' };
    }
  }

  return { tools, execute };
}

module.exports = { buildUniversityTools };
