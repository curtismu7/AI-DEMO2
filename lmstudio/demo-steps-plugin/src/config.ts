import { createConfigSchematics } from '@lmstudio/sdk';

export const configSchematics = createConfigSchematics()
  .field(
    'workflow',
    'select',
    {
      displayName: 'AI-DEMO2 workflow',
      subtitle: 'Choose a Demo Step or OpenSearch use case.',
      options: [
        { value: 'banking-everyday', displayName: 'Banking · Everyday Banking' },
        { value: 'banking-details', displayName: 'Banking · Account Details' },
        { value: 'banking-movement', displayName: 'Banking · Money Movement' },
        { value: 'banking-support', displayName: 'Banking · Support and Fees' },
        { value: 'banking-policy', displayName: 'Banking · Policy Guardrails' },
        { value: 'sports-legacy', displayName: 'Super Sports · Legacy Records' },
        { value: 'sports-rentals', displayName: 'Super Sports · Gear and Rentals' },
        { value: 'sports-orders', displayName: 'Super Sports · Orders and Loyalty' },
        { value: 'sports-stores-code', displayName: 'Super Sports · Stores and Code' },
        { value: 'sports-policy', displayName: 'Super Sports · Policy Guardrails' },
        { value: 'care-data', displayName: 'CareConnect · Health Data' },
        { value: 'care-coverage', displayName: 'CareConnect · Coverage and Claims' },
        { value: 'care-actions', displayName: 'CareConnect · Actions' },
        { value: 'care-policy', displayName: 'CareConnect · Policy Guardrails' },
        { value: 'everyday-banking-local-model', displayName: 'Model Paths · Everyday Banking · Local model' },
        { value: 'sports-stores-code-local-model', displayName: 'Model Paths · Super Sports Stores and Code · Local model' },
        { value: 'handoff-account-viewer', displayName: 'Handoffs · Account Viewer' },
        { value: 'handoff-front-desk', displayName: 'Handoffs · Front Desk' },
        { value: 'handoff-super-sports-checkout', displayName: 'Handoffs · Super Sports Checkout' },
        { value: 'opensearch-direct', displayName: 'OpenSearch · Direct' },
        { value: 'opensearch-via-privilege', displayName: 'OpenSearch · via Privilege' },
        { value: 'opensearch-privilege-opensearch22', displayName: 'OpenSearch · Privilege opensearch22' },
        { value: 'privilege-aggregate', displayName: 'OpenSearch · Privilege Aggregate' },
      ],
    },
    'banking-everyday',
  )
  .build();
