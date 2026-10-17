// Hosted-access registration flow shared by HostedRegistrationPage (invitee /
// requester side) and HostedRegistrationAdminPage (admin side). Mirrors
// demo_api_server routes/hostedRegistration.js, routes/demoProvisioning.js
// (/send-invite) and services/hostedRegistrationAdminService.js.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);

export const HOSTED_ACCESS_GROUPS = {
  person: { label: 'People', bg: 'var(--th-status-info)' },
  api: { label: 'Demo API', bg: 'var(--th-bg-emphasis)' },
  store: { label: 'Stores and PingOne', bg: 'var(--th-status-warning)' },
};

export const HOSTED_ACCESS_NODES = [
  N('requester', 'person', 'Requester', ['@pingidentity.com email,', 'name, cell phone'], 0, 0),
  N('invitee', 'person', 'Invitee', ['registers at', '/welcome?welcome=1'], 0, 260),
  N('admin', 'person', 'Admin', ['invites, then decides', 'on each request'], 0, 520),
  N('register', 'api', 'Hosted registration', ['POST /request, /verify', 'one-time email code'], 360, 0),
  N('invite', 'api', 'Invite endpoint', ['POST /api/demo/send-invite', 'admin only'], 360, 260),
  N('adminapi', 'api', 'Registration admin', ['/api/admin/hosted-registrations', 'approval, rejection, disable'], 360, 520),
  N('record', 'store', 'Registration record', ['status: otp_pending,', 'pending_approval, approved,', 'rejected, disabled'], 740, 130),
  N('pingone', 'store', 'PingOne', ['user + pending group;', 'approval moves to user/admin', 'group'], 740, 390),
];

export const HOSTED_ACCESS_EDGES = [
  E('requester', 'register', 'request: email, name, phone'), // 0
  E('register', 'record', 'record status otp_pending; code emailed'), // 1
  E('requester', 'register', 'verify: enter one-time code'), // 2
  E('register', 'record', 'status pending_approval; admin alerted'), // 3
  E('admin', 'invite', 'invite an email'), // 4
  E('invite', 'pingone', 'create or reuse user, park in pending group'), // 5
  E('invite', 'record', 'pending_approval record so the approval list shows it'), // 6
  E('invite', 'invitee', 'registration link (and password email if sent)'), // 7
  E('admin', 'adminapi', 'admin decision'), // 8
  E('adminapi', 'record', 'status updated'), // 9
  E('adminapi', 'pingone', 'approval moves user to the user/admin group'), // 10
];

export const HOSTED_ACCESS_STEPS = [
  { key: 'request', edges: [0, 1, 2, 3], title: 'A requester verifies their email', what: 'Only @pingidentity.com addresses are accepted. The request creates a record in otp_pending and emails a one-time code; a correct code moves it to pending_approval and alerts the admin.', why: 'The hosted-access wall only admits approved users, so a verified email alone grants nothing.' },
  { key: 'invite', edges: [4, 5, 6, 7], title: 'An admin invites someone directly', what: 'The invite endpoint provisions the account in PingOne, parks it in the pending group, writes a pending_approval record and returns the /welcome link to hand over.', why: 'The record makes invitees appear in the approval list, so the invite does not dead-end.' },
  { key: 'decide', edges: [8, 9, 10], title: 'The admin decides', what: 'Approval (or enabling a disabled user) sets approved and moves the user into the user or admin group; Reject and Disable update the record and PingOne.', why: 'The group move is what lets the person past the wall.' },
];
