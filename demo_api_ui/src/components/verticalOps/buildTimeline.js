export function buildTimeline(row = {}, customerName = 'this customer') {
  const events = [{ title: 'Record viewed by operator', when: 'just now' }];
  if (row.status) events.push({ title: `Status is "${row.status}"`, when: 'current' });
  if (row.createdAt) events.push({ title: `Record created for ${customerName}`, when: String(row.createdAt) });
  return events;
}
