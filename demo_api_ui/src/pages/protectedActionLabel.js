// What UC38 actually is differs per vertical (a transfer, a bill, a checkout...): name it from the tool.
const LABELS = {
  create_transfer: "transfer",
  pay_bill: "bill payment",
  checkout: "checkout",
  pay_fee: "fee payment",
  pay_tuition_balance: "tuition payment",
  submit_expense: "expense report",
  extend_rental: "rental extension",
  approve_purchase_order: "purchase order approval",
  large_trade: "large trade",
  pay_airline_fee: "airline fee payment",
};

export function protectedActionLabel(scenario) {
  const tool = scenario?.primaryTool;
  if (!tool) return "protected action";
  return LABELS[tool] || String(tool).replace(/_/g, " ");
}
