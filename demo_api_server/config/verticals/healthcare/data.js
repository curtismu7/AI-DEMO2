'use strict';

const path = require('path');
const fs = require('fs');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

/**
 * Per-vertical healthcare data store. Genuine healthcare objects (patient
 * records, appointments, coverage, claims) keyed by userId — NOT relabeled
 * banking accounts. Each user gets a deep clone of the seed on first access.
 */
function createHealthcareStore() {
  const byUser = new Map(); // userId -> cloned seed object

  function get(userId) {
    if (!byUser.has(userId)) {
      byUser.set(userId, structuredClone(SEED));
    }
    return byUser.get(userId);
  }

  let seq = 0;
  function bookAppointment(userId, { provider, clinic, when, reason }) {
    const data = get(userId);
    seq += 1;
    const appt = { id: `appt-new-${seq}`, provider, clinic, when, reason, status: 'Confirmed' };
    data.appointments.push(appt);
    return appt;
  }

  // Find an item by id in one of the user's seed arrays and apply a patch.
  // Returns the mutated item, or null when the id is unknown.
  function mutate(arr, id, updates) {
    const item = (arr || []).find((x) => x.id === id);
    if (!item) return null;
    Object.assign(item, updates);
    return item;
  }

  function markRecordReleased(userId, recordId) {
    return mutate(get(userId).patientRecords, recordId, { status: 'Released' });
  }

  function cancelAppointment(userId, appointmentId) {
    return mutate(get(userId).appointments, appointmentId, { status: 'Cancelled' });
  }

  function rescheduleAppointment(userId, appointmentId, when) {
    return mutate(get(userId).appointments, appointmentId,
      when ? { when, status: 'Rescheduled' } : { status: 'Rescheduled' });
  }

  function payBill(userId, billId) {
    return mutate(get(userId).billingHistory, billId, { status: 'Paid' });
  }

  function refillPrescription(userId, medicationId) {
    return mutate(get(userId).medications, medicationId, { status: 'Refill Requested' });
  }

  function markMessageRead(userId, messageId) {
    return mutate(get(userId).messages, messageId, { status: 'Read' });
  }

  function requestDocument(userId, documentId) {
    return mutate(get(userId).documents, documentId, { status: 'Requested' });
  }

  function cancelReferral(userId, referralId) {
    return mutate(get(userId).referrals, referralId, { status: 'Cancelled' });
  }

  return { get, bookAppointment, markRecordReleased, cancelAppointment, rescheduleAppointment, payBill, refillPrescription, markMessageRead, requestDocument, cancelReferral };
}

module.exports = { createHealthcareStore };
