export const LM_STUDIO_DEMO_STEPS = [
  {
    id: "accounts",
    title: "View accounts",
    prompt: "Show my accounts and balances.",
    tools: ["get_my_accounts"],
    outcome: "Permitted tool call with a transaction trace link.",
  },
  {
    id: "stores",
    title: "Find stores",
    prompt: "Find Super Sports stores near me.",
    tools: ["get_branch_hours"],
    outcome: "Permitted tool call with a transaction trace link.",
  },
  {
    id: "deny",
    title: "Policy denial",
    prompt: "Show a restricted customer record.",
    tools: ["get_sensitive_account_details"],
    outcome: "The authorization policy denies the tool call; no sensitive data is returned.",
  },
  {
    id: "hitl",
    title: "Human approval",
    prompt: "Transfer $50 from checking to savings.",
    tools: ["create_transfer"],
    outcome: "The call pauses for explicit human approval before execution.",
  },
  {
    id: "step-up",
    title: "Step-up MFA",
    prompt: "Show my sensitive account details.",
    tools: ["get_sensitive_account_details"],
    outcome: "The call pauses for step-up authentication before execution.",
  },
];
