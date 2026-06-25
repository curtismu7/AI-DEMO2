import { buildCustomerGreeting } from '../AIAgent';

test('buildCustomerGreeting substitutes {name} from manifest greeting', () => {
  const g = buildCustomerGreeting(
    { firstName: 'Sam', role: 'customer' },
    'Hi {name}! Shopping time. What would you like to do?'
  );
  expect(g).toBe('Hi Sam! Shopping time. What would you like to do?');
});

test('buildCustomerGreeting falls back when no manifest greeting', () => {
  const g = buildCustomerGreeting({ firstName: 'Sam', role: 'customer' }, null);
  expect(g).toContain('Sam');
});
