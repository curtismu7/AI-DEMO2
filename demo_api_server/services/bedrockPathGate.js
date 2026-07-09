'use strict';

/**
 * bedrockPathGate.js — AWS deployment gate for Bedrock feature flags.
 * Flags have no effect unless AWS_DEPLOYMENT=1 (EKS/production path).
 */

const configStore = require('./configStore');

/** @returns {boolean} */
function isAwsDeployment() {
  return process.env.AWS_DEPLOYMENT === '1';
}

/** @param {string} key configStore flag id */
function isFlagOn(key) {
  return configStore.getEffective(key) === 'true';
}

/** @returns {boolean} */
function isBedrockGatewayEffective() {
  return isAwsDeployment() && isFlagOn('ff_bedrock_agentcore_gateway');
}

/** @returns {boolean} */
function isBedrockLlmEffective() {
  return isAwsDeployment() && isFlagOn('ff_bedrock_llm');
}

/**
 * Fail closed when a Bedrock path is requested outside AWS deployment.
 * @param {'gateway'|'llm'} kind
 */
function assertBedrockPath(kind) {
  if (isAwsDeployment()) return;
  const err = new Error(`Bedrock ${kind} path requires AWS deployment (AWS_DEPLOYMENT=1)`);
  err.code = 'bedrock_aws_required';
  err.httpStatus = 503;
  throw err;
}

module.exports = {
  isAwsDeployment,
  isBedrockGatewayEffective,
  isBedrockLlmEffective,
  assertBedrockPath,
};
