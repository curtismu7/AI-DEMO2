'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('workforce') as {
  expenses: Array<{ id: string; [k: string]: unknown }>;
  benefits: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchWorkforceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_expenses':
      return { expenses: data.expenses, count: data.expenses.length };
    case 'get_expense': {
      const id = args.expense_id as string;
      const expense = data.expenses.find((e) => e.id === id);
      if (!expense) return { found: false, expense_id: id };
      return { found: true, expense };
    }
    default:
      throw new Error(`Unknown workforce tool: ${toolName}`);
  }
}
