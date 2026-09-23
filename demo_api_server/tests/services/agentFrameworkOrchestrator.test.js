'use strict';

const { selectFramework, FRAMEWORKS } = require('../../services/agentFrameworkOrchestrator');

describe('agentFrameworkOrchestrator.selectFramework', () => {
  test('FRAMEWORKS contains only langchain', () => {
    expect(FRAMEWORKS).toEqual(['langchain']);
  });

  test('auto selection always resolves to langchain', async () => {
    const result = await selectFramework({ message: 'what is my balance', vertical: 'super_sports' });
    expect(result).toBe('langchain');
  });
});
