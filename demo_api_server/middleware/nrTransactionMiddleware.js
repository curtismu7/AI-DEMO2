'use strict';
const nrContext = require('../services/nrContext');

const UC_NAMES = {
  UC1:  'UC1-ChipLogin',
  UC2:  'UC2-SensitiveTransfer',
  UC14: 'UC14-AttackSim',
  UC16: 'UC16-Impersonation',
  UC17: 'UC17-HITL',
  UC22: 'UC22-CIBA',
};

function nrTransactionMiddleware(req, res, next) {
  const useCaseId =
    req.body?.useCaseId ||
    req.query?.useCaseId ||
    req.headers?.['x-use-case-id'] ||
    null;
  const useCaseName = UC_NAMES[useCaseId] || (useCaseId ? `UC-${useCaseId}` : null);
  const ctx = nrContext.mintCorrelation(useCaseId, useCaseName);

  try {
    const newrelic = require('newrelic');
    if (useCaseId) {
      newrelic.setTransactionName(`/BankingDemo/${useCaseName}`);
    }
  } catch (_) {}

  nrContext.run(ctx, () => next());
}

module.exports = { nrTransactionMiddleware };
