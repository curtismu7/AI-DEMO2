'use strict';

const path = require('path');
const { createSeedStore } = require('../shared/createSeedStore');

/**
 * Per-vertical Super University data store. Genuine registrar objects
 * (courses, credit standing, enrollment history) keyed by userId — NOT
 * relabeled banking accounts. Per-user cloning + seed load come from the
 * shared createSeedStore helper; mutators receive the user's cloned data.
 */
function createUniversityStore() {
  let seq = 0;
  return createSeedStore(path.join(__dirname, 'seed.json'), {
    registerCourse(data, { course, title } = {}) {
      seq += 1;
      const entry = { id: `E-new-${seq}`, type: 'Registration', course: course || title || 'New Course', date: '2026-06-19', status: 'Confirmed' };
      data.enrollmentHistory.push(entry);
      return entry;
    },
    releaseTranscript(data, { recipient } = {}) {
      seq += 1;
      const entry = { id: `E-new-${seq}`, type: 'Transcript Release', course: '—', recipient: recipient || 'Third party', date: '2026-06-19', status: 'Released' };
      data.enrollmentHistory.push(entry);
      return { program: 'B.S. Computer Science', recipient: entry.recipient, status: 'Released' };
    },
  });
}

module.exports = { createUniversityStore };
