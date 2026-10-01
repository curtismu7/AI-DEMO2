'use strict';

// The previous implementation guessed at private Authentication Service
// endpoints and accepted client-provided session/image data. Keep every entry
// point closed until Ping/Keyless confirms the Web SDK's backend result and
// enrollment lifecycle contract for this tenant.
class RecognizeContractUnavailable extends Error {
  constructor() {
    super('PingOne Recognize Web SDK result validation is not configured');
    this.name = 'RecognizeContractUnavailable';
    this.code = 'RECOGNIZE_CONTRACT_UNAVAILABLE';
  }
}

function unavailable() {
  throw new RecognizeContractUnavailable();
}

function isConfigured() {
  return false;
}

async function initiateSession() { return unavailable(); }
async function verifySession() { return unavailable(); }
async function enrollUser() { return unavailable(); }
async function enrollFromImage() { return unavailable(); }
async function unenrollUser() { return unavailable(); }

module.exports = {
  isConfigured,
  initiateSession,
  verifySession,
  enrollUser,
  enrollFromImage,
  unenrollUser,
  RecognizeContractUnavailable,
};
