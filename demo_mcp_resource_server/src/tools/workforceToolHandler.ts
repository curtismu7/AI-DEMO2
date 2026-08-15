'use strict';
import { getExpense, listExpenses } from '../db/workforceDb';

export async function dispatchWorkforceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_expenses': {
      const expenses = listExpenses();
      return { expenses, count: expenses.length };
    }
    case 'get_expense': {
      const id = args.expense_id as string;
      const expense = getExpense(id);
      if (!expense) return { found: false, expense_id: id };
      return { found: true, expense };
    }
    default:
      throw new Error(`Unknown workforce tool: ${toolName}`);
  }
}
