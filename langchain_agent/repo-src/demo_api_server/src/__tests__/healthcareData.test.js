const { createHealthcareStore } = require('../../config/verticals/healthcare/data');

describe('healthcare data store', () => {
  let store;
  beforeEach(() => { store = createHealthcareStore(); });

  it('clones seed for a new user (independent copies)', () => {
    const a = store.get('user-a');
    store.get('user-b');
    a.appointments.push({ id: 'x' });
    expect(store.get('user-b').appointments.find((x) => x.id === 'x')).toBeUndefined();
  });

  it('bookAppointment appends an appointment and returns it', () => {
    const appt = store.bookAppointment('user-a', { provider: 'Dr. Lee', clinic: 'Downtown', when: '2026-07-01', reason: 'Checkup' });
    expect(appt.id).toBeDefined();
    expect(appt.status).toBe('Confirmed');
    expect(store.get('user-a').appointments.some((x) => x.id === appt.id)).toBe(true);
  });

  it('markRecordReleased flips a record status and returns it', () => {
    const recId = store.get('user-a').patientRecords[0].id;
    const rec = store.markRecordReleased('user-a', recId);
    expect(rec.status).toBe('Released');
  });

  it('markRecordReleased returns null for an unknown record', () => {
    expect(store.markRecordReleased('user-a', 'nope')).toBeNull();
  });
});
