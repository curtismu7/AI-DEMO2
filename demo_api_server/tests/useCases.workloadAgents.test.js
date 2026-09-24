'use strict';

const { VERTICALS, resolveUseCase } = require('../config/useCases');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { toolForAction } = require('./helpers/actionToTool');

describe('workload-agent use-case mappings', () => {
  it('maps UC38 to the vertical UC7 step-up action in every vertical', () => {
    for (const vertical of VERTICALS) {
      const uc38 = resolveUseCase('UC38', vertical);
      const uc7 = resolveUseCase('UC7', vertical);
      expect(uc38.primaryTool).toBe(uc7.primaryTool);
      expect(uc38.runPrompt).toBe(uc7.trigger.text);
      expect(uc38.trigger).toMatchObject({ type: 'link', path: '/workload-agents?useCase=UC38' });
    }
  });

  it('maps UC44 to a customer read distinct from UC38 in every vertical', () => {
    for (const vertical of VERTICALS) {
      const uc38 = resolveUseCase('UC38', vertical);
      const uc44 = resolveUseCase('UC44', vertical);
      const customerRead = resolveUseCase('UC1', vertical);
      expect(uc44.primaryTool).toBe(customerRead.primaryTool);
      expect(uc44.primaryTool).not.toBe(uc38.primaryTool);
      expect(uc44.runPrompt).toBe(customerRead.trigger.text);
      expect(uc44.trigger).toMatchObject({ type: 'link', path: '/workload-agents?useCase=UC44' });
    }
  });

  it('routes each catalog runner prompt to its declared action', () => {
    for (const vertical of VERTICALS) {
      for (const id of ['UC38', 'UC44']) {
        const useCase = resolveUseCase(id, vertical);
        const parsed = parseHeuristic(
          useCase.runPrompt,
          vertical,
          resolveVerticalCtx(vertical),
          {},
        );
        const action = parsed?.banking?.action ?? parsed?.action ?? null;
        expect(toolForAction(action, vertical)).toBe(useCase.primaryTool);
      }
    }
  });
});
