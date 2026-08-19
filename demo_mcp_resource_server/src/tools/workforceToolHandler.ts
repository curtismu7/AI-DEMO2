'use strict';
import { getExpense, insertExpense, listExpenses } from '../db/workforceDb';

export async function dispatchWorkforceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_expenses': {
      const expenses = listExpenses();
      return { expenses, count: expenses.length, render: 'list_expenses' };
    }
    case 'get_expense': {
      const id = args.expense_id as string;
      const expense = getExpense(id);
      if (!expense) return { found: false, expense_id: id };
      return { found: true, expense };
    }
    case 'submit_expense': {
      // Defaults mirror the BFF's submit_expense exactly: an amount-driven
      // policy chip may omit the category, and a consent/step-up showcase chip
      // may omit the amount too — both still have to run against a real
      // expense. A chip that DOES carry an amount keeps it (UC6/7/8 behavior).
      const category = typeof args.category === 'string' && args.category.trim() ? args.category.trim() : 'Travel';
      const amount = typeof args.amount === 'number' ? args.amount : 100;
      const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : undefined;
      const expense = insertExpense({ category, amount, description });
      // Flat — the BFF returns `result: expense` and the manifest's
      // submit_expense descriptor reads the expense's own fields.
      return { ...expense, render: 'submit_expense' };
    }
    default:
      throw new Error(`Unknown workforce tool: ${toolName}`);
  }
}
