'use strict';

const { buildHostedRegistrationEmailHtml } = require('../../services/emailService');

describe('hosted registration email templates', () => {
  test('builds a pending-approval confirmation with escaped user data', () => {
    const html = buildHostedRegistrationEmailHtml({
      email: 'alice@pingidentity.com',
      firstName: '<Alice>',
      status: 'pending_approval',
    });

    expect(html).toContain('Your email is verified and your request is waiting for administrator approval');
    expect(html).toContain('&lt;Alice&gt;');
    expect(html).not.toContain('<Alice>');
    expect(html).toContain('https://ai-demo.ping-devops.com/assets/ping-identity-logo.png');
    expect(html).toContain('#051727');
  });

  test('builds an approved confirmation with the hosted sign-in URL', () => {
    const html = buildHostedRegistrationEmailHtml({
      email: 'alice@pingidentity.com',
      firstName: 'Alice',
      status: 'approved',
      appUrl: 'https://example.test',
    });

    expect(html).toContain('Your hosted demo access is approved');
    expect(html).toContain('https://example.test');
    expect(html).toContain('https://ai-demo.ping-devops.com/assets/ping-identity-logo.png');
    expect(html).toContain('#B3282D');
  });
});
