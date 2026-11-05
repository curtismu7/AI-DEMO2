// /session-lab: SessionLabPage.jsx. Two sessions meet on this page: the real one the BFF holds for
// the signed-in user (read-only), and a simulated PingOne session you change with the buttons.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASHED = { dashed: true };

export const SESSION_LAB_GROUPS = {
  user: { label: 'Browser', bg: '#151a24' },
  flow: { label: 'DaVinci flow', bg: '#5a5f69' },
  ping: { label: 'PingOne', bg: '#b5231a' },
};

export const SESSION_LAB_NODES = [
  N('browser', 'user', 'Browser', ['holds the PingOne session cookie', '(on the PingOne host)'], 0, 150),
  N('login', 'flow', 'Sign-in flow', ['checks the password, may run', 'MFA, then reports methods'], 400, 0),
  N('rsr', 'flow', 'Return Success Response', ['reports methods and the', 'idle timeout; slides both'], 400, 300),
  N('check', 'flow', 'Check Session', ['one method, signed on within', 'N minutes, not idle-expired'], 400, 600),
  N('session', 'ping', 'PingOne session', ['one record: a last sign-on', 'time per method, idle window'], 800, 150),
  N('app', 'ping', 'App tokens', ['auth_time and amr describe', 'the sign-in behind them'], 800, 450),
];

export const SESSION_LAB_EDGES = [
  E('browser', 'login', 'start sign-in'), // 0
  E('login', 'rsr', 'user proven: methods named by the flow'), // 1
  E('rsr', 'session', 'create or update the session'), // 2
  E('session', 'browser', 'session cookie', DASHED), // 3
  E('browser', 'check', 'later visit: is the user still good?'), // 4
  E('check', 'session', 'read per-method times and idle window'), // 5
  E('session', 'app', 'sign-on facts reach the tokens', DASHED), // 6
];

const S = (key, i, title, what, why) => ({ key, edges: [i], title, what, why });

export const SESSION_LAB_STEPS = [
  S('start', 0, 'Sign-in starts', 'The browser enters a DaVinci flow.', 'The flow, not PingOne, decides what counts as signed in.'),
  S('methods', 1, 'The flow names the methods', 'After its checks, the flow tells Return Success Response which methods happened: pwd, mfa, fido and so on.', 'PingOne does not detect methods. They are labels the flow sets, so a flow can report one that never ran.'),
  S('write', 2, 'One session is written', 'Return Success Response creates the session or updates it: each reported method gets a fresh last sign-on and the idle window slides.', 'There is one user session. Methods are entries inside it.'),
  S('cookie', 3, 'The browser keeps the cookie', 'The session cookie lives on the PingOne host, so this app cannot read it.', 'This page can show the BFF session next to it, never the PingOne cookie itself.'),
  S('later', 4, 'A later visit asks Check Session', 'Check Session wants one method, signed on within N minutes, before idle expiry.', 'The N is the flow author\'s policy, not a PingOne default of the session.'),
  S('read', 5, 'It reads the record', 'The check compares now with that method\'s last sign-on and with the idle window.', 'A check does not slide anything. Only a Return Success Response does.'),
  S('tokens', 6, 'Tokens carry the result', 'auth_time and amr in the tokens describe the sign-in behind them.', 'UNVERIFIED: exactly how they are set when an app signs on through an existing session.'),
];

export const SESSION_LAB_DIAGRAM = { GROUPS: SESSION_LAB_GROUPS, NODES: SESSION_LAB_NODES, EDGES: SESSION_LAB_EDGES, STEPS: SESSION_LAB_STEPS };
