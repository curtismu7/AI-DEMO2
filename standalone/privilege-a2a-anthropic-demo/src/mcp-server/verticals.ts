/**
 * Per-vertical specialist tools for the A2A demo. Entirely fictional, static
 * fixtures shaped like demo_api_server/config/verticals/<v>/tools.js results.
 * `specialistName`, `subtaskHint` and tool names mirror
 * demo_api_server/config/a2aSpecialists.js; test/verticals.test.ts fails on drift.
 */

export interface VerticalSpecialist {
  specialistName: string;
  subtaskHint: string;
  /** tool name -> description and fixture result; `records` (keyed by lowercase user id) overrides `result` for that user */
  tools: Record<string, { description: string; result: unknown; records?: Record<string, unknown> }>;
}

const sensitive = (data: unknown) => ({ data, sensitiveDataAccessed: true });

// A white-label vertical shares its domain's specialist (same as A2A_SPECIALIST_ALIASES in
// demo_api_server/config/a2aSpecialists.js; test/verticals.test.ts fails on drift).
export const VERTICAL_ALIASES: Record<string, string> = { 'abercrombie-fitch': 'retail' };

export const resolveVertical = (vertical: string): string => VERTICAL_ALIASES[vertical] ?? vertical;

export const VERTICALS: Record<string, VerticalSpecialist> = {
  banking: {
    specialistName: 'Investment Advisor',
    subtaskHint: 'review the customer’s investment positions',
    tools: {
      get_portfolio_summary: {
        description: 'Summarise the customer’s investment portfolio: total value and allocation.',
        result: { totalValue: 48250.75, allocation: { equities: 0.62, bonds: 0.28, cash: 0.1 }, accounts: 2 },
      },
      get_investment_accounts: {
        description: 'List the customer’s investment accounts.',
        result: { accounts: [
          { id: 'INV-1001', type: 'Brokerage', balance: 31200.5 },
          { id: 'INV-1002', type: 'Retirement IRA', balance: 17050.25 },
        ] },
      },
      get_investment_balance: {
        description: 'Get the current balance of the customer’s investment accounts.',
        result: { balance: 48250.75, currency: 'USD', asOf: '2026-01-15' },
      },
      get_investment_transactions: {
        description: 'List recent investment transactions.',
        result: { transactions: [
          { id: 'TX-5001', date: '2026-01-10', type: 'buy', symbol: 'FUND-A', amount: 1500 },
          { id: 'TX-5002', date: '2025-12-20', type: 'dividend', symbol: 'FUND-B', amount: 212.4 },
        ] },
      },
    },
  },
  healthcare: {
    specialistName: 'Records Specialist',
    subtaskHint: 'retrieve the sensitive patient health record',
    tools: { sensitive_patient_records: {
      description: 'Access highly sensitive patient health records.',
      result: sensitive({ records: [
        { type: 'diagnosis', date: '2025-11-03', summary: 'Annual physical, normal' },
        { type: 'prescription', date: '2025-11-03', medication: 'Example-Statin 10mg', status: 'active' },
      ] }),
    } },
  },
  retail: {
    specialistName: 'Purchase History Specialist',
    subtaskHint: 'review the sensitive order / purchase history',
    tools: { sensitive_order_history: {
      description: 'Access the customer’s sensitive order and purchase history.',
      result: sensitive({ orders: [
        { orderId: 'ORD-9982', date: '2025-12-01', total: 249.99, status: 'delivered' },
        { orderId: 'ORD-8841', date: '2025-10-14', total: 89.0, status: 'returned' },
      ] }),
    } },
  },
  'sporting-goods': {
    specialistName: 'Membership Specialist',
    subtaskHint: 'review the sensitive membership details',
    tools: { sensitive_membership_details: {
      description: 'Access the customer’s sensitive membership details.',
      result: sensitive({ membershipTier: 'Gold', renewsOn: '2026-08-01', lifetimeSpend: 1842.5, benefits: ['free shipping', 'early access'] }),
      records: {
        demouser: sensitive({ membershipTier: 'Silver', renewsOn: '2027-02-14', lifetimeSpend: 412.9, benefits: ['free shipping'] }),
      },
    } },
  },
  workforce: {
    specialistName: 'Payroll Specialist',
    subtaskHint: 'review the sensitive payroll details',
    tools: { sensitive_payroll_details: {
      description: 'Access the employee’s sensitive payroll details.',
      result: sensitive({ payGrade: 'G7', lastPayslipDate: '2025-12-31', deductions: [{ type: 'retirement', amount: 310 }, { type: 'health', amount: 145 }] }),
    } },
  },
  government: {
    specialistName: 'Tax Records Specialist',
    subtaskHint: 'retrieve the sensitive tax assessment record',
    tools: { sensitive_tax_record: {
      description: 'Access the sensitive tax assessment record.',
      result: sensitive({ record: { parcel: '00-00-000-001', assessedValue: 312000, lastAssessed: '2025-06-30', outstandingBalance: 0 } }),
    } },
  },
  university: {
    specialistName: 'Financial Aid Specialist',
    subtaskHint: 'review the sensitive student financial aid record',
    tools: { sensitive_student_finance: {
      description: 'Access the student’s sensitive financial aid record.',
      result: sensitive({ record: { awardYear: '2025-2026', grantAward: 6200, pendingDisbursement: 1800, remainingTuitionBalance: 950 } }),
    } },
  },
  manufacturing: {
    specialistName: 'Supplier Contract Specialist',
    subtaskHint: 'review the sensitive supplier contract terms',
    tools: { sensitive_supplier_contract: {
      description: 'Access the sensitive supplier contract terms.',
      result: sensitive({ contract: { supplier: 'Example Components Inc.', contractId: 'SC-0000-0001', expires: '2027-03-31', paymentTerms: 'Net 45' } }),
    } },
  },
  investment: {
    specialistName: 'Holdings Specialist',
    subtaskHint: 'review the sensitive investment holdings',
    tools: { sensitive_holdings: {
      description: 'Access sensitive investment holdings with cost-basis detail.',
      result: { holdings: [
        { symbol: 'FUND-A', quantity: 120, costBasis: 9800, marketValue: 12400 },
        { symbol: 'FUND-B', quantity: 60, costBasis: 5400, marketValue: 5100 },
      ], note: 'Sensitive cost-basis / tax-lot detail', sensitiveDataAccessed: true },
    } },
  },
  airlines: {
    specialistName: 'Passenger Records Specialist',
    subtaskHint: 'retrieve the sensitive passenger record',
    tools: { sensitive_passenger_record: {
      description: 'Access the sensitive passenger record.',
      result: sensitive({ loyaltyStatus: 'Silver', upcomingTrips: [{ flight: 'XX 100', date: '2026-02-14', route: 'AAA-BBB' }], passport: 'on file' }),
    } },
  },
  admin: {
    specialistName: 'Identity Verification Specialist',
    subtaskHint: 'retrieve the customer’s identity-verification (KYC) record',
    tools: { sensitive_customer_identity: {
      description: 'Access the customer’s identity-verification (KYC) record.',
      result: sensitive({ kycStatus: 'verified', verifiedOn: '2025-09-12', method: 'document + selfie', customer: 'Sample Customer' }),
    } },
  },
};
