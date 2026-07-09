'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const configStore = require('../services/configStore');
const {
  isAwsDeployment,
  isBedrockGatewayEffective,
  isBedrockLlmEffective,
  assertBedrockPath,
} = require('../services/bedrockPathGate');

describe('bedrockPathGate', () => {
  const origAws = process.env.AWS_DEPLOYMENT;

  afterEach(() => {
    process.env.AWS_DEPLOYMENT = origAws;
    jest.clearAllMocks();
  });

  it('isAwsDeployment returns true when AWS_DEPLOYMENT=1', () => {
    process.env.AWS_DEPLOYMENT = '1';
    expect(isAwsDeployment()).toBe(true);
  });

  it('isBedrockGatewayEffective requires flag AND aws', () => {
    process.env.AWS_DEPLOYMENT = '1';
    configStore.getEffective.mockReturnValue('true');
    expect(isBedrockGatewayEffective()).toBe(true);

    process.env.AWS_DEPLOYMENT = '';
    expect(isBedrockGatewayEffective()).toBe(false);

    process.env.AWS_DEPLOYMENT = '1';
    configStore.getEffective.mockReturnValue('false');
    expect(isBedrockGatewayEffective()).toBe(false);
  });

  it('isBedrockLlmEffective requires flag AND aws', () => {
    process.env.AWS_DEPLOYMENT = '1';
    configStore.getEffective.mockImplementation((k) =>
      (k === 'ff_bedrock_llm' ? 'true' : 'false'));
    expect(isBedrockLlmEffective()).toBe(true);

    process.env.AWS_DEPLOYMENT = '';
    expect(isBedrockLlmEffective()).toBe(false);
  });

  it('assertBedrockPath throws 503 without AWS_DEPLOYMENT', () => {
    process.env.AWS_DEPLOYMENT = '';
    expect(() => assertBedrockPath('gateway')).toThrow(/AWS deployment/);
    try {
      assertBedrockPath('llm');
    } catch (err) {
      expect(err.code).toBe('bedrock_aws_required');
      expect(err.httpStatus).toBe(503);
    }
  });

  it('assertBedrockPath is no-op on AWS deployment', () => {
    process.env.AWS_DEPLOYMENT = '1';
    expect(() => assertBedrockPath('gateway')).not.toThrow();
  });
});
