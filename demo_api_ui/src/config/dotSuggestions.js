import { verticalSuggestionChips } from '../components/agentChrome';

const RECALL = 'What do you remember about me?';
const NEUTRAL = ['Always keep your answers short', 'Call me Sam'];

/**
 * Dot's suggested prompts for the ACTIVE vertical: its first three plain chips (the same prompts
 * the main agent offers; mode 'direct' attack-sim chips are skipped), then the generic recall question,
 * which is what makes Dot Dot. Signed-out guests get a stripped manifest (identity + theme only,
 * see routes/verticalManifest.js /me) and a manifest that is still loading has none either: those
 * get two vertical-neutral preference prompts instead, never another vertical's prompts.
 * @returns {{ label: string, message: string }[]}
 */
export function dotSuggestions(pageManifest) {
  const own = verticalSuggestionChips(pageManifest)
    // show_* chips are the main agent's feature demos: the page-side chip runs them, the chat path has no
    // handler and answers with the capabilities list. Never offer a prompt chat cannot run.
    .filter((c) => c.message && c.mode !== 'direct' && !String(c.tool || '').startsWith('show_'))
    .slice(0, 3)
    .map((c) => ({ label: c.label, message: c.message }));
  const lead = own.length ? own : NEUTRAL.map((t) => ({ label: t, message: t }));
  return [...lead, { label: RECALL, message: RECALL }];
}

// The Studio and pop-out chats talk to the airline demo, so every skin offers the same airline prompts;
// Dot adds the recall question, which is what makes Dot Dot. Paying a fee is a consent-gated write, so it
// shows the PingOne MFA approval (the airline has no transfer-miles tool, so that prompt can't be offered).
const AIRLINE_PROMPTS = [
  'What is my loyalty status?',
  'Show my airline bookings',
  'pay a $300 change fee',
];

/** @returns {{ label: string, message: string }[]} */
export function airlineSuggestions(skin) {
  const prompts = skin === 'dot' ? [...AIRLINE_PROMPTS, RECALL] : AIRLINE_PROMPTS;
  return prompts.map((t) => ({ label: t, message: t }));
}

/**
 * The Studio's suggested prompts for the ACTIVE vertical. The airline vertical keeps its tuned prompts (a
 * consent-gated fee payment shows the PingOne MFA approval); any other vertical offers its own first three chips,
 * the same prompts the main agent offers. A guest's stripped manifest, or one still loading, has none: those get
 * the two vertical-neutral preference prompts, never another vertical's prompts. Dot adds the recall question.
 * @returns {{ label: string, message: string }[]}
 */
export function studioSuggestions(skin, verticalId, pageManifest) {
  if (!verticalId || verticalId === 'airlines') return airlineSuggestions(skin);
  const own = verticalSuggestionChips(pageManifest)
    .filter((c) => c.message && c.mode !== 'direct' && !String(c.tool || '').startsWith('show_'))
    .slice(0, 3)
    .map((c) => ({ label: c.label, message: c.message }));
  const lead = own.length ? own : NEUTRAL.map((t) => ({ label: t, message: t }));
  return skin === 'dot' ? [...lead, { label: RECALL, message: RECALL }] : lead;
}

const AIRLINE_GREETING = "Hello! I'm your digital assistant. I can access your MileagePlus account and help manage your upcoming flights. What would you like to do today?";
const GENERIC_GREETING = "Hello! I'm your digital assistant. What would you like to do today?";

/** The Studio's opening line: the airline one only for the airline vertical (it names MileagePlus). */
export function studioGreeting(verticalId) {
  return !verticalId || verticalId === 'airlines' ? AIRLINE_GREETING : GENERIC_GREETING;
}

/**
 * The suggestions still worth offering mid-conversation: everything not already sent. Used to keep
 * "try next" chips under the replies instead of hiding all chips after the first message.
 * @param {({ label: string, message: string }|string)[]} suggestions
 * @param {string[]} sentTexts the user prompts already sent
 */
export function unusedSuggestions(suggestions, sentTexts) {
  const sent = new Set(sentTexts.map((t) => String(t).trim().toLowerCase()));
  return suggestions
    .map((s) => (typeof s === 'string' ? { label: s, message: s } : s))
    .filter(({ message }) => !sent.has(String(message).trim().toLowerCase()));
}
