'use strict';

/**
 * Healthcare tools — the vertical's OWN actions over its OWN data store.
 * No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildHealthcareTools(store) {
  const tools = [
    { name: 'view_records', description: 'List the patient\'s medical records.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_coverage', description: 'Show the patient\'s insurance coverage summary.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_appointments', description: 'List the patient\'s appointments.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_claims', description: 'List the patient\'s insurance claims and their status.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_billing', description: 'List the patient\'s bills and amounts due.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'pay_bill', description: 'Pay an outstanding bill.', inputSchema: { type: 'object', properties: { billId: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_appointment', description: 'Cancel an existing appointment.', inputSchema: { type: 'object', properties: { appointmentId: { type: 'string' } }, required: ['appointmentId'] }, scopes: ['write'], authz: {} },
    { name: 'reschedule_appointment', description: 'Reschedule an existing appointment to a new date/time.', inputSchema: { type: 'object', properties: { appointmentId: { type: 'string' }, when: { type: 'string' } }, required: ['appointmentId'] }, scopes: ['write'], authz: {} },
    { name: 'view_medications', description: "List the patient's current medications with dosage, frequency, and refill status", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'refill_prescription', description: "Request a prescription refill for a medication by id", inputSchema: { type: 'object', properties: { medicationId: { type: 'string' } }, required: ['medicationId'] }, scopes: ['write'], authz: {} },
    { name: 'view_lab_results', description: "Retrieve the patient's lab test results including test name, date, value, reference range, and status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_vitals', description: "Retrieve the patient's recorded vital signs (blood pressure, weight, heart rate, etc.)", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_care_team', description: "List the patient's assigned care team members including name, specialty, clinic, and contact details", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_messages', description: "List secure inbox messages for the patient, showing sender, subject, date, and read/unread status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_referrals', description: "List specialist referrals for the current patient", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_documents', description: "List the patient's health documents (discharge summaries, reports, consent forms, clinical notes)", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_immunizations', description: "List the patient's immunization history including vaccine name, date administered, dose, and status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_allergies', description: "List all recorded allergies for the patient including allergen, reaction, severity, and status", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_dependents', description: "List all covered dependents and family members on the patient's health plan", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_care_plan', description: "Fetch the patient's active care plan goals including targets, due dates, and status", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'mark_message_read', description: "Mark a secure portal message as read by messageId", inputSchema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] }, scopes: ['write'], authz: {} },
    { name: 'request_document', description: "Request or download a health document by id, setting its status to Requested", inputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, required: [] }, scopes: ['write'], authz: {} },
    { name: 'cancel_referral', description: "Cancel a pending or scheduled specialist referral by referralId, setting its status to Cancelled", inputSchema: { type: 'object', properties: { referralId: { type: 'string' } }, required: ['referralId'] }, scopes: ['write'], authz: {} },
    { name: 'book_appointment', description: 'Book a new appointment with a provider.', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, clinic: { type: 'string' }, when: { type: 'string' }, reason: { type: 'string' } }, required: [] }, scopes: ['write'], authz: {} },
    { name: 'release_records', description: 'Release medical records to a third party (requires step-up + consent).', inputSchema: { type: 'object', properties: { recordId: { type: 'string' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
    { name: 'sensitive_patient_records', description: 'Access highly sensitive patient health records. Requires explicit user consent.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: { consent: true } },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  // Declarative tables for the uniform tools (the 15-intent expansion). READ
  // tools wrap one seed array under its own key; WRITE tools mutate one item's
  // status by id. The id may arrive as the schema param (LLM path) or as
  // params.recordId (heuristic extractsRecordId) — the one alias lives here.
  // Bespoke tools (book/release/sensitive) and the irregular legacy reads
  // (view_records/view_coverage/view_billing) stay in the switch below.
  const READ_TOOLS = {
    view_medications: 'medications', view_lab_results: 'labResults', view_vitals: 'vitals',
    view_care_team: 'careTeam', list_messages: 'messages', view_referrals: 'referrals',
    view_documents: 'documents', view_immunizations: 'immunizations', view_allergies: 'allergies',
    view_dependents: 'dependents', view_care_plan: 'carePlan',
  };
  const WRITE_TOOLS = {
    refill_prescription: { method: 'refillPrescription', idParam: 'medicationId', noun: 'medication' },
    mark_message_read: { method: 'markMessageRead', idParam: 'messageId', noun: 'message' },
    // defaultFrom: UC28's one-click chip carries no id. Falling back to the first
    // record in that collection demonstrates the request-only boundary instead of
    // dead-ending on "I need: Document ID". Explicit-id callers are unaffected.
    request_document: { method: 'requestDocument', idParam: 'documentId', noun: 'document', defaultFrom: 'documents' },
    cancel_referral: { method: 'cancelReferral', idParam: 'referralId', noun: 'referral' },
  };

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    if (READ_TOOLS[name]) {
      const key = READ_TOOLS[name];
      return { result: { [key]: store.get(userId)[key] }, render: name };
    }
    if (WRITE_TOOLS[name]) {
      const { method, idParam, noun, defaultFrom } = WRITE_TOOLS[name];
      let id = params && (params[idParam] || params.recordId);
      if (!id && defaultFrom) id = ((store.get(userId)[defaultFrom] || [])[0] || {}).id;
      const item = store[method](userId, id);
      if (!item) return { result: { error: `${noun} not found` }, render: 'text' };
      return { result: item, render: name };
    }
    switch (name) {
      case 'view_records':
        return { result: { records: store.get(userId).patientRecords }, render: 'view_records' };
      case 'view_coverage':
        return { result: store.get(userId).coverage, render: 'view_coverage' };
      case 'list_appointments':
        return { result: { appointments: store.get(userId).appointments }, render: 'list_appointments' };
      case 'view_claims':
        return { result: { claims: store.get(userId).claims }, render: 'view_claims' };
      case 'view_billing':
        return { result: { bills: store.get(userId).billingHistory }, render: 'view_billing' };
      case 'pay_bill': {
        // Amount-driven policy chips ("pay my $300 bill") don't carry a bill id —
        // default to the first outstanding bill so the Authorize outcome can be shown.
        let _billId = params && (params.billId || params.recordId);
        if (!_billId) { const _bills = store.get(userId).billingHistory || []; _billId = _bills[0] && _bills[0].id; }
        const bill = store.payBill(userId, _billId);
        if (!bill) return { result: { error: 'bill not found' }, render: 'text' };
        return { result: bill, render: 'pay_bill' };
      }
      case 'cancel_appointment': {
        const appt = store.cancelAppointment(userId, (params && (params.appointmentId || params.recordId || params.id)));
        if (!appt) return { result: { error: 'appointment not found' }, render: 'text' };
        return { result: appt, render: 'cancel_appointment' };
      }
      case 'reschedule_appointment': {
        const appt = store.rescheduleAppointment(userId, (params && (params.appointmentId || params.recordId)), params && params.when);
        if (!appt) return { result: { error: 'appointment not found' }, render: 'text' };
        return { result: appt, render: 'reschedule_appointment' };
      }
      case 'book_appointment': {
        // One-click "Book an appointment" chip carries no provider/when — default both to
        // nominal values so the booking runs instead of dead-ending on a missing-param prompt.
        const _p = params || {};
        const _provider = (_p.provider && String(_p.provider).trim()) ? _p.provider : 'Dr. Smith';
        const _when = (_p.when && String(_p.when).trim()) ? _p.when : 'next week';
        return { result: store.bookAppointment(userId, { ..._p, provider: _provider, when: _when }), render: 'book_appointment' };
      }
      case 'release_records': {
        // Consent/step-up showcase chips carry no record id — default to the first record
        // so the security control (consent + step-up) is demonstrated against a real record.
        const _rid = (params && params.recordId) || (store.get(userId).patientRecords[0] || {}).id;
        const rec = store.markRecordReleased(userId, _rid);
        if (!rec) return { result: { error: 'record not found' }, render: 'text' };
        return { result: rec, render: 'release_records' };
      }
      case 'sensitive_patient_records':
        return {
          result: {
            data: {
              records: [
                { type: 'diagnosis', date: '2025-11-03', summary: 'Annual physical — normal' },
                { type: 'prescription', date: '2025-11-03', medication: '[REDACTED]', status: 'active' },
              ],
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

module.exports = { buildHealthcareTools };
