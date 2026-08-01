import { TokenChainAuditor } from '../../src/tools/TokenChainAuditor';
import { JwtClaimVerifier } from '../../src/tools/JwtClaimVerifier';
import { AuditLogger } from '../../src/utils/AuditLogger';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import type { Session } from '../../src/interfaces/auth';
import type { BankingToolDefinition } from '../../src/tools/BankingToolRegistry';
import type { BankingToolResult } from '../../src/tools/BankingToolProvider';

const baseTool: BankingToolDefinition = {
  name: 'get_my_accounts',
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  requiredScopes: ['read'],
  requiresUserAuth: true,
  handler: 'executeGetMyAccounts',
  readOnly: true,
};

function makeSession(sessionId = 'sess-1'): Session {
  return {
    sessionId,
    userTokens: undefined,
    createdAt: new Date(),
    lastActivity: new Date(),
  } as unknown as Session;
}

const okResult: BankingToolResult = { type: 'text', text: 'ok', success: true };

describe('TokenChainAuditor', () => {
  let auditLogger: jest.Mocked<AuditLogger>;
  let verifier: JwtClaimVerifier;
  let logger: Logger;

  beforeEach(() => {
    logger = Logger.getInstance(createDefaultLoggerConfig());
    auditLogger = { logTokenChain: jest.fn() } as unknown as jest.Mocked<AuditLogger>;
    verifier = new JwtClaimVerifier(logger);
  });

  it('record increments chain index per session', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 'get_my_accounts', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 5 });
    await a.record({ toolName: 'get_my_accounts', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 5 });
    const calls = (auditLogger.logTokenChain as jest.Mock).mock.calls;
    expect(calls.length).toBe(2);
    // chainIndex is the 2nd positional arg (index 1) in logTokenChain
    expect(calls[0][1]).toBe(1);
    expect(calls[1][1]).toBe(2);
  });

  it('chain indices independent across sessions', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 1 });
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s2'), result: okResult, executionTime: 1 });
    const calls = (auditLogger.logTokenChain as jest.Mock).mock.calls;
    expect(calls[0][1]).toBe(1);
    expect(calls[1][1]).toBe(1);
  });

  it('clearSession resets the chain index for that session', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 1 });
    a.clearSession('s1');
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 1 });
    expect((auditLogger.logTokenChain as jest.Mock).mock.calls[1][1]).toBe(1);
  });

  it('record never throws even when auditLogger rejects', async () => {
    (auditLogger.logTokenChain as jest.Mock).mockRejectedValue(new Error('audit boom'));
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await expect(
      a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), result: okResult, executionTime: 1 })
    ).resolves.toBeUndefined();
  });

  it('builds exchangedTokenInfo when agentToken provided, null otherwise', async () => {
    const a = new TokenChainAuditor(auditLogger, verifier, logger);
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s1'), agentToken: 'agent-tok', result: okResult, executionTime: 1 });
    await a.record({ toolName: 't', tool: baseTool, session: makeSession('s2'), result: okResult, executionTime: 1 });
    const calls = (auditLogger.logTokenChain as jest.Mock).mock.calls;
    // exchangedTokenInfo is the 4th positional arg (index 3) in logTokenChain
    expect(calls[0][3]).not.toBeNull();
    expect(calls[1][3]).toBeNull();
  });
});
