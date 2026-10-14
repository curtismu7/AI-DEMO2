import { createConfigSchematics } from '@lmstudio/sdk';

export const configSchematics = createConfigSchematics()
  .field(
    'workflow',
    'select',
    {
      displayName: 'AI-DEMO2 workflow',
      subtitle: 'Choose a Super Sports or OpenSearch use case.',
      options: [
        { value: 'sports-legacy', displayName: 'Super Sports · Legacy Records' },
        { value: 'sports-rentals', displayName: 'Super Sports · Gear and Rentals' },
        { value: 'sports-orders', displayName: 'Super Sports · Orders and Loyalty' },
        { value: 'sports-stores-code', displayName: 'Super Sports · Stores and Code' },
        { value: 'sports-policy', displayName: 'Super Sports · Policy Guardrails' },
        { value: 'sports-stores-code-local-model', displayName: 'Model Paths · Super Sports Stores and Code · Local model' },
        { value: 'handoff-super-sports-checkout', displayName: 'Handoffs · Super Sports Checkout' },
        { value: 'opensearch-direct', displayName: 'OpenSearch · Direct' },
        { value: 'opensearch-via-privilege', displayName: 'OpenSearch · via Privilege' },
        { value: 'opensearch-privilege-opensearch', displayName: 'OpenSearch · Privilege (3 tools)' },
        { value: 'privilege-aggregate', displayName: 'OpenSearch · Privilege Aggregate' },
      ],
    },
    'sports-legacy',
  )
  .field(
    'demoMode',
    'select',
    {
      displayName: 'Demo response mode',
      subtitle: 'Fast keeps tool demos brief; Guided adds one-line handoff context.',
      options: [
        { value: 'fast', displayName: 'Fast demo' },
        { value: 'guided', displayName: 'Guided demo' },
      ],
    },
    'fast',
  )
  .build();
